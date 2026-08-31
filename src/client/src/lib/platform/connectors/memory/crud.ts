/**
 * Project-scoped CRUD for memory connector instances.
 *
 * Memory connectors persist on Prisma `ConnectorInstance`. API keys are
 * encrypted onto `secretRef` (same `enc:v1:` scheme as vault values) so adding
 * Claude/Mem0/Zep does not require ClickHouse. Raw keys never appear in API
 * responses.
 */

import { randomUUID } from "crypto";
import { headers } from "next/headers";
import prisma from "@/lib/prisma";
import { createProjectEnvironment } from "@/lib/project-environment";
import {
	getCurrentOrganisation,
	getCurrentProjectForOrganisation,
} from "@/lib/organisation";
import { assertPremiumConnectorAllowed } from "@/lib/access/connector-entitlement";
import { OPENLIT_CONTEXT_HEADERS } from "@/constants/openlit-context";
import { normalizeDatasourceEndpointUrl } from "@/lib/platform/connectors/datasource/http/endpoint-url";
import { invalidateSourceSecretCache } from "@/lib/platform/connectors/datasource/http/secret";
import { encryptValue, isEncrypted } from "@/utils/crypto";
import { ensureMemoryAdaptersRegistered } from "./bootstrap";
import {
	createMemoryAdapter,
	getMemoryTypeDescriptor,
	hasMemoryAdapterFactory,
	listMemoryTypeDescriptors,
} from "./registry";
import type { MemoryPortLink, MemorySourceDescriptor } from "./types";
import { connectorDescription } from "../descriptions";
import { connectorIconPath } from "../icons";
import {
	MEMORY_CONNECTOR_NAME_REQUIRED,
	MEMORY_CONNECTOR_NAME_TAKEN,
	MEMORY_CONNECTOR_NO_PROJECT,
	MEMORY_CONNECTOR_NOT_FOUND,
	MEMORY_CONNECTOR_TYPE_UNKNOWN,
	MEMORY_CONNECTOR_INLINE_SECRET_REQUIRED,
	TELEMETRY_SOURCE_INVALID_SETTINGS,
} from "@/constants/messages/en";

export const MEMORY_CONNECTOR_PREFIX = "memory:";

export function memoryConnectorId(id: string): string {
	const trimmed = String(id || "").trim();
	return trimmed.startsWith(MEMORY_CONNECTOR_PREFIX)
		? trimmed
		: `${MEMORY_CONNECTOR_PREFIX}${trimmed}`;
}

export function isMemoryConnectorId(id: unknown): boolean {
	return String(id || "").startsWith(MEMORY_CONNECTOR_PREFIX);
}

export interface MemoryConnectorInput {
	name?: unknown;
	environment?: unknown;
	type?: unknown;
	settings?: unknown;
	secretRef?: unknown;
	credentials?: unknown;
}

/** Public memory connector row — never includes secretRef. */
export type MemoryConnectorPublic = {
	id: string;
	name: string;
	type: string;
	environment: string;
	organisationId: string | null;
	projectId: string | null;
	settings: string;
	status: string;
	metadata: string;
	createdAt: Date;
	updatedAt: Date;
	hasSecret: boolean;
	category: "memory";
	scope: "project";
	signals: string;
	isDefault: boolean;
};

function sanitize(row: {
	id: string;
	name: string;
	type: string;
	environment: string;
	organisationId: string | null;
	projectId: string | null;
	settings: string;
	secretRef?: string | null;
	status: string;
	metadata: string;
	createdAt: Date;
	updatedAt: Date;
}): MemoryConnectorPublic {
	return {
		id: row.id,
		name: row.name,
		type: row.type,
		environment: row.environment,
		organisationId: row.organisationId,
		projectId: row.projectId,
		settings: row.settings,
		status: row.status,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		metadata: publicConnectorMetadata(row.metadata ?? "{}"),
		hasSecret: !!row.secretRef,
		category: "memory",
		scope: "project",
		signals: "",
		isDefault: false,
	};
}

async function requireCurrentProject(): Promise<{
	organisationId: string;
	projectId: string;
}> {
	const org = await getCurrentOrganisation();
	if (!org?.id) throw new Error(MEMORY_CONNECTOR_NO_PROJECT);
	const project = await getCurrentProjectForOrganisation(org.id);
	if (!project?.id) throw new Error(MEMORY_CONNECTOR_NO_PROJECT);
	return { organisationId: org.id, projectId: project.id };
}

function normalizeEnvironment(value: unknown): string {
	const environment = String(value || "production").trim().toLowerCase();
	if (!/^[a-z0-9][a-z0-9._-]{0,62}$/.test(environment)) {
		throw new Error(
			"Environment must use letters, numbers, dots, hyphens, or underscores."
		);
	}
	return environment;
}

/**
 * Memory connectors are environment-scoped (same hierarchy as datasources).
 * Prefer an explicit argument, then the request `x-openlit-environment` header,
 * else production.
 */
async function resolveMemoryEnvironment(environment?: string): Promise<string> {
	if (environment != null && String(environment).trim()) {
		return normalizeEnvironment(environment);
	}
	try {
		const headerStore = await headers();
		const fromHeader = headerStore.get(OPENLIT_CONTEXT_HEADERS.environment);
		if (fromHeader?.trim()) return normalizeEnvironment(fromHeader);
	} catch {
		/* outside a Next.js request (unit tests / scripts) */
	}
	return "production";
}

function normalizeSettingsObject(settings: Record<string, unknown>): Record<string, unknown> {
	const next = { ...settings };
	if (typeof next.url === "string" && next.url.trim()) {
		next.url = normalizeDatasourceEndpointUrl(next.url);
	}
	return next;
}

function normalizeSettings(settings: unknown): string {
	if (settings === undefined || settings === null) return "{}";
	if (typeof settings === "string") {
		try {
			const parsed = JSON.parse(settings);
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
				throw new Error(TELEMETRY_SOURCE_INVALID_SETTINGS);
			}
			return JSON.stringify(normalizeSettingsObject(parsed as Record<string, unknown>));
		} catch (error) {
			if (error instanceof Error && error.message === TELEMETRY_SOURCE_INVALID_SETTINGS) {
				throw error;
			}
			throw new Error(TELEMETRY_SOURCE_INVALID_SETTINGS);
		}
	}
	if (typeof settings === "object" && !Array.isArray(settings)) {
		return JSON.stringify(normalizeSettingsObject(settings as Record<string, unknown>));
	}
	throw new Error(TELEMETRY_SOURCE_INVALID_SETTINGS);
}

function credentialsToSecretRef(
	credentials: unknown
): string | undefined {
	if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) {
		return undefined;
	}
	const entries = Object.entries(credentials as Record<string, unknown>).filter(
		([, v]) => typeof v === "string" && v.trim() !== ""
	);
	if (entries.length === 0) return undefined;
	return encryptValue(JSON.stringify(Object.fromEntries(entries)));
}

async function validateSecretReference(secretRef: string | null) {
	if (!secretRef) return;
	if (isEncrypted(secretRef)) return;
	throw new Error(MEMORY_CONNECTOR_INLINE_SECRET_REQUIRED);
}

function validateType(type: unknown): string {
	ensureMemoryAdaptersRegistered();
	const t = String(type || "").trim();
	if (!t || !hasMemoryAdapterFactory(t) || getMemoryTypeDescriptor(t)?.internal) {
		throw new Error(MEMORY_CONNECTOR_TYPE_UNKNOWN(String(type)));
	}
	return t;
}

export function isMemoryConnectorType(type: unknown): boolean {
	ensureMemoryAdaptersRegistered();
	return hasMemoryAdapterFactory(String(type || "").trim());
}

export function availableMemoryTypeDescriptors() {
	ensureMemoryAdaptersRegistered();
	return listMemoryTypeDescriptors().map((descriptor) => ({
		...descriptor,
		category: "memory" as const,
		scope: "project" as const,
		declaredSignals: [] as string[],
		description:
			descriptor.description ||
			connectorDescription(descriptor.type, descriptor.displayName),
		icon: descriptor.icon || connectorIconPath(descriptor.type),
	}));
}

function parseJsonObject(raw: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(raw || "{}");
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		/* keep empty */
	}
	return {};
}

function publicConnectorMetadata(raw: string): string {
	const parsed = parseJsonObject(raw);
	delete parsed.memoryPorts;
	delete parsed.memoryFilters;
	return JSON.stringify(parsed);
}

function asPortLink(value: unknown): MemoryPortLink | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const row = value as Record<string, unknown>;
	const sourceConnectorId = String(row.sourceConnectorId || "").trim();
	const sourceMemoryId = String(row.sourceMemoryId || "").trim();
	if (!sourceConnectorId || !sourceMemoryId) return null;
	return {
		sourceConnectorId,
		sourceConnectorType: String(row.sourceConnectorType || "") || undefined,
		sourceConnectorName: String(row.sourceConnectorName || "") || undefined,
		sourceMemoryId,
		originConnectorId: String(row.originConnectorId || "") || undefined,
		originMemoryId: String(row.originMemoryId || "") || undefined,
		copiedAt: String(row.copiedAt || ""),
		contentFingerprint: String(row.contentFingerprint || ""),
		destMemoryId: String(row.destMemoryId || "") || undefined,
	};
}

export async function readMemoryPortLinks(id: string): Promise<MemoryPortLink[]> {
	const row = await getMemoryConnector(id);
	const ports = parseJsonObject(row.metadata || "{}").memoryPorts;
	if (!Array.isArray(ports)) return [];
	return ports.map(asPortLink).filter((link): link is MemoryPortLink => !!link);
}

export async function recordMemoryPortLinks(
	id: string,
	links: MemoryPortLink[]
): Promise<void> {
	if (!links.length) return;
	const { projectId } = await requireCurrentProject();
	const instanceId = memoryConnectorId(id);
	const existing = await prisma.connectorInstance.findFirst({
		where: { id: instanceId, projectId, category: "memory" },
	});
	if (!existing) throw new Error(MEMORY_CONNECTOR_NOT_FOUND);
	const metadata = parseJsonObject(existing.metadata || "{}");
	const current = Array.isArray(metadata.memoryPorts) ? metadata.memoryPorts : [];
	const merged = new Map<string, MemoryPortLink>();
	for (const item of [...current, ...links]) {
		const link = asPortLink(item);
		if (!link) continue;
		merged.set(`${link.sourceConnectorId}:${link.sourceMemoryId}`, link);
	}
	const next = Array.from(merged.values()).slice(-500);
	await prisma.connectorInstance.update({
		where: { id: instanceId },
		data: { metadata: JSON.stringify({ ...metadata, memoryPorts: next }) },
	});
}

const MAX_REMEMBERED_FILTERS = 100;

export interface RememberedMemoryFilters {
	users: string[];
	sessions: string[];
	agents: string[];
}

export function emptyRememberedMemoryFilters(): RememberedMemoryFilters {
	return { users: [], sessions: [], agents: [] };
}

function uniqueFilterIds(values: unknown): string[] {
	const seen = new Set<string>();
	const next: string[] = [];
	const rows = Array.isArray(values) ? values : [];
	for (const value of rows) {
		const id =
			typeof value === "string"
				? value.trim()
				: value && typeof value === "object" && !Array.isArray(value)
					? String((value as { id?: unknown }).id || "").trim()
					: "";
		if (!id || seen.has(id)) continue;
		seen.add(id);
		next.push(id);
	}
	return next.slice(-MAX_REMEMBERED_FILTERS);
}

function asRememberedFilters(raw: unknown): RememberedMemoryFilters {
	const row =
		raw && typeof raw === "object" && !Array.isArray(raw)
			? (raw as Record<string, unknown>)
			: {};
	return {
		users: uniqueFilterIds(row.users),
		sessions: uniqueFilterIds(row.sessions),
		agents: uniqueFilterIds(row.agents),
	};
}

export async function readRememberedMemoryFilters(
	id: string
): Promise<RememberedMemoryFilters> {
	const row = await getMemoryConnector(id);
	return asRememberedFilters(parseJsonObject(row.metadata || "{}").memoryFilters);
}

export async function rememberMemoryFilters(
	id: string,
	patch: Partial<RememberedMemoryFilters>
): Promise<void> {
	const extra = asRememberedFilters(patch);
	if (!extra.users.length && !extra.sessions.length && !extra.agents.length) {
		return;
	}
	const { projectId } = await requireCurrentProject();
	const instanceId = memoryConnectorId(id);
	const existing = await prisma.connectorInstance.findFirst({
		where: { id: instanceId, projectId, category: "memory" },
	});
	if (!existing) throw new Error(MEMORY_CONNECTOR_NOT_FOUND);
	const metadata = parseJsonObject(existing.metadata || "{}");
	const current = asRememberedFilters(metadata.memoryFilters);
	const next = {
		users: uniqueFilterIds([...current.users, ...extra.users]),
		sessions: uniqueFilterIds([...current.sessions, ...extra.sessions]),
		agents: uniqueFilterIds([...current.agents, ...extra.agents]),
	};
	if (
		next.users.length === current.users.length &&
		next.sessions.length === current.sessions.length &&
		next.agents.length === current.agents.length &&
		next.users.every((id, index) => id === current.users[index]) &&
		next.sessions.every((id, index) => id === current.sessions[index]) &&
		next.agents.every((id, index) => id === current.agents[index])
	) {
		return;
	}
	await prisma.connectorInstance.update({
		where: { id: instanceId },
		data: { metadata: JSON.stringify({ ...metadata, memoryFilters: next }) },
	});
}

function parseSettings(settings: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(settings || "{}");
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		/* keep empty */
	}
	return {};
}

function toRuntimeDescriptor(row: {
	id: string;
	type: string;
	name: string;
	settings: string;
	secretRef?: string | null;
	projectId?: string | null;
	environment?: string | null;
}): MemorySourceDescriptor {
	return {
		type: row.type,
		id: row.id,
		settings: parseSettings(row.settings),
		secretRef: row.secretRef,
		projectId: row.projectId ?? null,
		name: row.name,
		environment: row.environment || undefined,
	};
}

export async function createMemoryConnector(input: MemoryConnectorInput) {
	const { organisationId, projectId } = await requireCurrentProject();
	const name = String(input.name || "").trim();
	if (!name) throw new Error(MEMORY_CONNECTOR_NAME_REQUIRED);
	const type = validateType(input.type);
	await assertPremiumConnectorAllowed(type);
	const environment = normalizeEnvironment(input.environment);
	await createProjectEnvironment(environment);
	const settings = normalizeSettings(input.settings);
	const credentialSecretRef = credentialsToSecretRef(input.credentials);
	const secretRef =
		credentialSecretRef ??
		(typeof input.secretRef === "string" ? input.secretRef : null);
	await validateSecretReference(secretRef);

	const existing = await prisma.connectorInstance.findFirst({
		where: { projectId, name, environment },
		select: { id: true },
	});
	if (existing) throw new Error(MEMORY_CONNECTOR_NAME_TAKEN(name, environment));

	const created = await prisma.connectorInstance.create({
		data: {
			id: memoryConnectorId(randomUUID()),
			category: "memory",
			type,
			name,
			environment,
			organisationId,
			projectId,
			settings,
			secretRef,
			status: "active",
			metadata: JSON.stringify({ category: "memory" }),
		},
	});
	return sanitize(created);
}

export async function updateMemoryConnector(id: string, input: MemoryConnectorInput) {
	const { projectId } = await requireCurrentProject();
	const instanceId = memoryConnectorId(id);
	const existing = await prisma.connectorInstance.findFirst({
		where: { id: instanceId, projectId, category: "memory" },
	});
	if (!existing) throw new Error(MEMORY_CONNECTOR_NOT_FOUND);

	const name = input.name === undefined ? existing.name : String(input.name || "").trim();
	if (!name) throw new Error(MEMORY_CONNECTOR_NAME_REQUIRED);
	const environment =
		input.environment === undefined
			? existing.environment
			: normalizeEnvironment(input.environment);
	await createProjectEnvironment(environment);
	const settings =
		input.settings === undefined ? existing.settings : normalizeSettings(input.settings);
	const credentialSecretRef = credentialsToSecretRef(input.credentials);
	const secretRef =
		credentialSecretRef ??
		(typeof input.secretRef === "string" ? input.secretRef : existing.secretRef);
	await validateSecretReference(secretRef || null);

	if (name !== existing.name || environment !== existing.environment) {
		const clash = await prisma.connectorInstance.findFirst({
			where: {
				projectId,
				name,
				environment,
				NOT: { id: instanceId },
			},
			select: { id: true },
		});
		if (clash) throw new Error(MEMORY_CONNECTOR_NAME_TAKEN(name, environment));
	}

	const updated = await prisma.connectorInstance.update({
		where: { id: instanceId },
		data: {
			name,
			environment,
			settings,
			secretRef,
			status: "active",
		},
	});
	if (credentialSecretRef || input.secretRef) {
		invalidateSourceSecretCache(existing.secretRef || undefined);
	}
	return sanitize(updated);
}

export async function deleteMemoryConnector(id: string) {
	const { projectId } = await requireCurrentProject();
	const instanceId = memoryConnectorId(id);
	const existing = await prisma.connectorInstance.findFirst({
		where: { id: instanceId, projectId, category: "memory" },
		select: { id: true, secretRef: true },
	});
	if (!existing) throw new Error(MEMORY_CONNECTOR_NOT_FOUND);
	await prisma.connectorInstance.delete({ where: { id: instanceId } });
	invalidateSourceSecretCache(existing.secretRef || undefined);
	return { ok: true };
}

export async function getMemoryConnector(id: string) {
	const { projectId } = await requireCurrentProject();
	const instanceId = memoryConnectorId(id);
	const existing = await prisma.connectorInstance.findFirst({
		where: { id: instanceId, projectId, category: "memory" },
	});
	if (!existing) throw new Error(MEMORY_CONNECTOR_NOT_FOUND);
	return existing;
}

export async function listMemoryConnectors(environment?: string) {
	ensureMemoryAdaptersRegistered();
	const { projectId } = await requireCurrentProject();
	const env = await resolveMemoryEnvironment(environment);
	const rows = await prisma.connectorInstance.findMany({
		where: { projectId, category: "memory", environment: env },
		orderBy: [{ createdAt: "asc" }],
	});
	return rows.filter((row) => hasMemoryAdapterFactory(row.type)).map(sanitize);
}

export async function getMemoryRuntime(id?: string, environment?: string) {
	ensureMemoryAdaptersRegistered();
	const { projectId } = await requireCurrentProject();
	const env = await resolveMemoryEnvironment(environment);
	const instanceId = id ? memoryConnectorId(id) : undefined;
	const row = instanceId
		? await prisma.connectorInstance.findFirst({
				where: {
					id: instanceId,
					projectId,
					category: "memory",
					environment: env,
				},
			})
		: await prisma.connectorInstance.findFirst({
				where: { projectId, category: "memory", environment: env },
				orderBy: [{ createdAt: "asc" }],
			});
	if (!row) throw new Error(MEMORY_CONNECTOR_NOT_FOUND);
	const adapter = createMemoryAdapter(toRuntimeDescriptor(row));
	if (!adapter) throw new Error(MEMORY_CONNECTOR_TYPE_UNKNOWN(row.type));
	return { adapter, connector: sanitize(row) };
}

export async function healthCheckMemoryConnector(id: string) {
	ensureMemoryAdaptersRegistered();
	const row = await getMemoryConnector(id);
	const adapter = createMemoryAdapter(toRuntimeDescriptor(row));
	if (!adapter) throw new Error(MEMORY_CONNECTOR_TYPE_UNKNOWN(row.type));
	return adapter.healthCheck();
}
