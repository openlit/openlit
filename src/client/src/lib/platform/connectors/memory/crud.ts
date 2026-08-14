/**
 * Project-scoped CRUD for memory connector instances.
 *
 * Memory connectors persist on Prisma `ConnectorInstance`. API keys are
 * encrypted onto `secretRef` (same `enc:v1:` scheme as vault values) so adding
 * Mem0/Zep does not require ClickHouse. Raw keys never appear in API responses.
 */

import { randomUUID } from "crypto";
import prisma from "@/lib/prisma";
import { createProjectEnvironment } from "@/lib/project-environment";
import {
	getCurrentOrganisation,
	getCurrentProjectForOrganisation,
} from "@/lib/organisation";
import { getSecretById } from "@/lib/platform/vault";
import { assertPremiumConnectorAllowed } from "@/lib/access/connector-entitlement";
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
import type { MemorySourceDescriptor } from "./types";
import { connectorDescription } from "../descriptions";
import { connectorIconPath } from "../icons";
import {
	MEMORY_CONNECTOR_NAME_REQUIRED,
	MEMORY_CONNECTOR_NAME_TAKEN,
	MEMORY_CONNECTOR_NO_PROJECT,
	MEMORY_CONNECTOR_NOT_FOUND,
	MEMORY_CONNECTOR_TYPE_UNKNOWN,
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

function sanitize(row: {
	secretRef?: string | null;
	settings: string;
	[key: string]: unknown;
}) {
	const { secretRef, ...rest } = row;
	return {
		...rest,
		settings: row.settings,
		hasSecret: !!secretRef,
		category: "memory" as const,
		scope: "project" as const,
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
	const result = await getSecretById(secretRef);
	if (!(result.data as unknown[] | undefined)?.length) {
		throw new Error("The selected vault secret is not owned by the current user.");
	}
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

export async function listMemoryConnectors() {
	const { projectId } = await requireCurrentProject();
	const rows = await prisma.connectorInstance.findMany({
		where: { projectId, category: "memory" },
		orderBy: [{ environment: "asc" }, { createdAt: "asc" }],
	});
	return rows.map(sanitize);
}

export async function getMemoryRuntime(id?: string) {
	ensureMemoryAdaptersRegistered();
	const { projectId } = await requireCurrentProject();
	const instanceId = id ? memoryConnectorId(id) : undefined;
	const row = instanceId
		? await prisma.connectorInstance.findFirst({
				where: { id: instanceId, projectId, category: "memory" },
			})
		: await prisma.connectorInstance.findFirst({
				where: { projectId, category: "memory" },
				orderBy: [{ environment: "asc" }, { createdAt: "asc" }],
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
