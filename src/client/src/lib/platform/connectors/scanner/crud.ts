/**
 * Project-scoped CRUD for scanner connector instances.
 *
 * Scanner connectors persist on Prisma `ConnectorInstance`. GitHub tokens are
 * encrypted onto `secretRef` (same `enc:v1:` scheme as vault values). Raw
 * tokens never appear in API responses.
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
import { invalidateSourceSecretCache } from "@/lib/platform/connectors/datasource/http/secret";
import { encryptValue, isEncrypted } from "@/utils/crypto";
import { ensureScannerAdaptersRegistered } from "./bootstrap";
import { describeTrustablRuntime, installTrustablCli } from "./install";
import {
	createScannerAdapter,
	getScannerTypeDescriptor,
	hasScannerAdapterFactory,
	listScannerTypeDescriptors,
} from "./registry";
import type { ScannerJob, ScannerScanInput, ScannerSourceDescriptor } from "./types";
import { connectorDescription } from "../descriptions";
import { connectorIconPath } from "../icons";
import {
	SCANNER_CONNECTOR_NAME_REQUIRED,
	SCANNER_CONNECTOR_NAME_TAKEN,
	SCANNER_CONNECTOR_NO_PROJECT,
	SCANNER_CONNECTOR_NOT_FOUND,
	SCANNER_CONNECTOR_TYPE_UNKNOWN,
	SCANNER_CONNECTOR_INLINE_SECRET_REQUIRED,
	SCANNER_JOB_RUNNING,
	SCANNER_SCAN_FAILED,
	TELEMETRY_SOURCE_INVALID_SETTINGS,
} from "@/constants/messages/en";
import { hasRunningScannerJob, jobsFromMetadata, prependScannerJob } from "./jobs";
import {
	normalizeScannerDetectors,
	normalizeScannerRef,
	normalizeScannerRulesRepo,
	normalizeScannerRulesSource,
	normalizeScannerTarget,
} from "./target";
import { parseScannerScanInput } from "./scan-params";
import { isScannerExtraSettingKey } from "./cli-schema";
import { newScannerJobId } from "./report";

export const SCANNER_CONNECTOR_PREFIX = "scanner:";

export function scannerConnectorId(id: string): string {
	const trimmed = String(id || "").trim();
	return trimmed.startsWith(SCANNER_CONNECTOR_PREFIX)
		? trimmed
		: `${SCANNER_CONNECTOR_PREFIX}${trimmed}`;
}

export function isScannerConnectorId(id: unknown): boolean {
	return String(id || "").startsWith(SCANNER_CONNECTOR_PREFIX);
}

export interface ScannerConnectorInput {
	name?: unknown;
	environment?: unknown;
	type?: unknown;
	settings?: unknown;
	secretRef?: unknown;
	credentials?: unknown;
}

export type ScannerConnectorPublic = {
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
	category: "scanner";
	scope: "project";
	signals: string;
	isDefault: boolean;
	jobs: ScannerJob[];
};

function publicConnectorMetadata(raw: string): string {
	const parsed = (() => {
		try {
			const value = JSON.parse(raw || "{}");
			if (value && typeof value === "object" && !Array.isArray(value)) {
				return value as Record<string, unknown>;
			}
		} catch {
			/* keep empty */
		}
		return {};
	})();
	delete parsed.jobs;
	return JSON.stringify(parsed);
}

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
}): ScannerConnectorPublic {
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
		category: "scanner",
		scope: "project",
		signals: "",
		isDefault: false,
		jobs: jobsFromMetadata(row.metadata || "{}"),
	};
}

async function requireCurrentProject(): Promise<{
	organisationId: string;
	projectId: string;
}> {
	const org = await getCurrentOrganisation();
	if (!org?.id) throw new Error(SCANNER_CONNECTOR_NO_PROJECT);
	const project = await getCurrentProjectForOrganisation(org.id);
	if (!project?.id) throw new Error(SCANNER_CONNECTOR_NO_PROJECT);
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

async function resolveScannerEnvironment(environment?: string): Promise<string> {
	if (environment != null && String(environment).trim()) {
		return normalizeEnvironment(environment);
	}
	try {
		const headerStore = await headers();
		const fromHeader = headerStore.get(OPENLIT_CONTEXT_HEADERS.environment);
		if (fromHeader?.trim()) return normalizeEnvironment(fromHeader);
	} catch {
		/* outside a Next.js request */
	}
	return "production";
}

function normalizeBooleanSetting(value: unknown): boolean | undefined {
	if (value === true || value === "true") return true;
	if (value === false || value === "false") return false;
	return undefined;
}

function normalizeSettingsObject(settings: Record<string, unknown>): Record<string, unknown> {
	const next = { ...settings };
	if (next.target != null && String(next.target).trim()) {
		next.target = normalizeScannerTarget(next.target);
	}
	if (next.ref != null) {
		const ref = normalizeScannerRef(next.ref);
		if (ref) next.ref = ref;
		else delete next.ref;
	}
	if (next.detectors != null) {
		const detectors = normalizeScannerDetectors(next.detectors);
		if (detectors) next.detectors = detectors;
		else delete next.detectors;
	}
	if (next.rulesRepo != null) {
		const rulesRepo = normalizeScannerRulesRepo(next.rulesRepo);
		if (rulesRepo) next.rulesRepo = rulesRepo;
		else delete next.rulesRepo;
	}
	if (next.rulesRef != null) {
		const rulesRef = normalizeScannerRef(next.rulesRef);
		if (rulesRef) next.rulesRef = rulesRef;
		else delete next.rulesRef;
	}
	if (next.rulesSource != null) {
		const rulesSource = normalizeScannerRulesSource(next.rulesSource);
		if (rulesSource) next.rulesSource = rulesSource;
		else delete next.rulesSource;
	}
	for (const key of [
		"strict",
		"secretScan",
		"vulnScan",
		"licenseScan",
		"requireSigned",
		"noRulesUpdate",
		"verbose",
	] as const) {
		const flag = normalizeBooleanSetting(next[key]);
		if (flag === undefined) delete next[key];
		else next[key] = flag;
	}
	for (const [key, value] of Object.entries(next)) {
		if (!isScannerExtraSettingKey(key)) continue;
		if (typeof value === "boolean") continue;
		if (value === "true" || value === "false") {
			next[key] = value === "true";
			continue;
		}
		if (typeof value === "string") {
			const trimmed = value.trim().slice(0, 500);
			if (!trimmed || /[\r\n\0]/.test(trimmed) || trimmed.startsWith("-")) delete next[key];
			else next[key] = trimmed;
			continue;
		}
		delete next[key];
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

function credentialsToSecretRef(credentials: unknown): string | undefined {
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
	throw new Error(SCANNER_CONNECTOR_INLINE_SECRET_REQUIRED);
}

function validateType(type: unknown): string {
	ensureScannerAdaptersRegistered();
	const t = String(type || "").trim();
	if (!t || !hasScannerAdapterFactory(t) || getScannerTypeDescriptor(t)?.internal) {
		throw new Error(SCANNER_CONNECTOR_TYPE_UNKNOWN(String(type)));
	}
	return t;
}

export function isScannerConnectorType(type: unknown): boolean {
	ensureScannerAdaptersRegistered();
	return hasScannerAdapterFactory(String(type || "").trim());
}

export function availableScannerTypeDescriptors() {
	ensureScannerAdaptersRegistered();
	return listScannerTypeDescriptors().map((descriptor) => ({
		...descriptor,
		category: "scanner" as const,
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
}): ScannerSourceDescriptor {
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

export async function createScannerConnector(input: ScannerConnectorInput) {
	const { organisationId, projectId } = await requireCurrentProject();
	const name = String(input.name || "").trim();
	if (!name) throw new Error(SCANNER_CONNECTOR_NAME_REQUIRED);
	const type = validateType(input.type);
	await assertPremiumConnectorAllowed(type);
	const environment = normalizeEnvironment(input.environment);
	await createProjectEnvironment(environment);
	const settings = normalizeSettings(input.settings);
	const parsedSettings = parseSettings(settings);
	if (type === "trustabl") normalizeScannerTarget(parsedSettings.target);
	const credentialSecretRef = credentialsToSecretRef(input.credentials);
	const secretRef =
		credentialSecretRef ??
		(typeof input.secretRef === "string" ? input.secretRef : null);
	await validateSecretReference(secretRef);

	const existing = await prisma.connectorInstance.findFirst({
		where: { projectId, name, environment },
		select: { id: true },
	});
	if (existing) throw new Error(SCANNER_CONNECTOR_NAME_TAKEN(name, environment));

	const created = await prisma.connectorInstance.create({
		data: {
			id: scannerConnectorId(randomUUID()),
			category: "scanner",
			type,
			name,
			environment,
			organisationId,
			projectId,
			settings,
			secretRef,
			status: "active",
			metadata: JSON.stringify({ category: "scanner", jobs: [] }),
		},
	});
	return sanitize(created);
}

export async function updateScannerConnector(id: string, input: ScannerConnectorInput) {
	const { projectId } = await requireCurrentProject();
	const instanceId = scannerConnectorId(id);
	const existing = await prisma.connectorInstance.findFirst({
		where: { id: instanceId, projectId, category: "scanner" },
	});
	if (!existing) throw new Error(SCANNER_CONNECTOR_NOT_FOUND);

	const name = input.name === undefined ? existing.name : String(input.name || "").trim();
	if (!name) throw new Error(SCANNER_CONNECTOR_NAME_REQUIRED);
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
		if (clash) throw new Error(SCANNER_CONNECTOR_NAME_TAKEN(name, environment));
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

export async function deleteScannerConnector(id: string) {
	const { projectId } = await requireCurrentProject();
	const instanceId = scannerConnectorId(id);
	const existing = await prisma.connectorInstance.findFirst({
		where: { id: instanceId, projectId, category: "scanner" },
		select: { id: true, secretRef: true },
	});
	if (!existing) throw new Error(SCANNER_CONNECTOR_NOT_FOUND);
	await prisma.connectorInstance.delete({ where: { id: instanceId } });
	invalidateSourceSecretCache(existing.secretRef || undefined);
	return { ok: true };
}

export async function getScannerConnector(id: string) {
	const { projectId } = await requireCurrentProject();
	const instanceId = scannerConnectorId(id);
	const existing = await prisma.connectorInstance.findFirst({
		where: { id: instanceId, projectId, category: "scanner" },
	});
	if (!existing) throw new Error(SCANNER_CONNECTOR_NOT_FOUND);
	return existing;
}

export async function listScannerConnectors(environment?: string) {
	ensureScannerAdaptersRegistered();
	const { projectId } = await requireCurrentProject();
	const env = await resolveScannerEnvironment(environment);
	const rows = await prisma.connectorInstance.findMany({
		where: { projectId, category: "scanner", environment: env },
		orderBy: [{ createdAt: "asc" }],
	});
	return rows.filter((row) => hasScannerAdapterFactory(row.type)).map(sanitize);
}

export async function getScannerRuntime(id?: string, environment?: string) {
	ensureScannerAdaptersRegistered();
	const { projectId } = await requireCurrentProject();
	const env = await resolveScannerEnvironment(environment);
	const instanceId = id ? scannerConnectorId(id) : undefined;
	const row = instanceId
		? await prisma.connectorInstance.findFirst({
				where: {
					id: instanceId,
					projectId,
					category: "scanner",
					environment: env,
				},
			})
		: await prisma.connectorInstance.findFirst({
				where: { projectId, category: "scanner", environment: env },
				orderBy: [{ createdAt: "asc" }],
			});
	if (!row) throw new Error(SCANNER_CONNECTOR_NOT_FOUND);
	const adapter = createScannerAdapter(toRuntimeDescriptor(row));
	if (!adapter) throw new Error(SCANNER_CONNECTOR_TYPE_UNKNOWN(row.type));
	return { adapter, connector: sanitize(row), row };
}

export async function healthCheckScannerConnector(id: string) {
	ensureScannerAdaptersRegistered();
	const row = await getScannerConnector(id);
	const adapter = createScannerAdapter(toRuntimeDescriptor(row));
	if (!adapter) throw new Error(SCANNER_CONNECTOR_TYPE_UNKNOWN(row.type));
	return adapter.healthCheck();
}

export async function getScannerCliRuntime() {
	ensureScannerAdaptersRegistered();
	return describeTrustablRuntime();
}

export async function installScannerRuntime(id?: string, input: { upgrade?: boolean } = {}) {
	ensureScannerAdaptersRegistered();
	if (id) await getScannerRuntime(id);
	const runtime = await installTrustablCli(input);
	return { runtime };
}

export async function runScannerJob(id: string, input: ScannerScanInput = {}) {
	const { adapter, connector, row } = await getScannerRuntime(id);
	if (hasRunningScannerJob(row.metadata || "{}")) {
		throw new Error(SCANNER_JOB_RUNNING);
	}
	const settings = parseSettings(row.settings);
	const running: ScannerJob = {
		id: newScannerJobId(),
		status: "running",
		target: String(input.target || settings.target || ""),
		ref: input.ref ? String(input.ref) : undefined,
		params: parseScannerScanInput(input as Record<string, unknown>),
		startedAt: new Date().toISOString(),
	};
	await prependScannerJob(row.id, running);
	try {
		const job = await adapter.scan(input);
		await prependScannerJob(row.id, job);
		return { connector, job };
	} catch (error) {
		const failed: ScannerJob = {
			...running,
			status: "failed",
			finishedAt: new Date().toISOString(),
			error: error instanceof Error ? error.message : SCANNER_SCAN_FAILED,
		};
		await prependScannerJob(row.id, failed);
		throw error;
	}
}
