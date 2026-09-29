/**
 * Project-scoped CRUD for `TelemetrySource` rows plus health/AI-signal probes.
 *
 * Every operation is scoped to the caller's *current* project (resolved from
 * their current organisation membership), so a user can never read or mutate a
 * source in a project they are not a member of. Adapter health checks and AI
 * signal validation bind a concrete adapter for the row and call into the
 * datasource layer, so the UI can show honest reachability/capability state.
 */

import { randomUUID } from "crypto";
import prisma from "./prisma";
import { createProjectEnvironment } from "./project-environment";
import {
	getCurrentOrganisation,
	getCurrentProjectForOrganisation,
} from "@/lib/organisation";
import { getSecretById, upsertSecret } from "./platform/vault";
import {
	parseSignals,
	toDescriptor,
	resolveTelemetrySourceDescriptor,
} from "./telemetry-source";
import { ensureAdaptersRegistered } from "./platform/connectors/datasource/bootstrap";
import {
	createAdapter,
	getSourceTypeDescriptor,
	hasAdapterFactory,
	listSourceTypeDescriptors,
} from "./platform/connectors/datasource/registry";
import type { TelemetrySource } from "@prisma/client";
import type {
	AISignalValidation,
	HealthCheckResult,
	QueryTimeRange,
	Signal,
	SourceCapabilities,
} from "./platform/connectors/datasource/types";
import { UnsupportedCapabilityError } from "./platform/connectors/datasource/types";
import { connectorDescription } from "./platform/connectors/descriptions";
import { connectorIconPath } from "./platform/connectors/icons";
import {
	removeLegacyConnector,
	syncTelemetrySourceConnector,
} from "@/lib/platform/connectors/instances";
import { assertPremiumConnectorAllowed } from "@/lib/access/connector-entitlement";
import {
	TELEMETRY_SOURCE_NAME_REQUIRED,
	TELEMETRY_SOURCE_NAME_TAKEN,
	TELEMETRY_SOURCE_TYPE_UNKNOWN,
	TELEMETRY_SOURCE_NO_PROJECT,
	TELEMETRY_SOURCE_NOT_FOUND,
	TELEMETRY_SOURCE_INVALID_SETTINGS,
	TELEMETRY_SOURCE_SIGNAL_NOT_IN_TYPE,
	TELEMETRY_SOURCE_NO_SIGNALS,
	TELEMETRY_SOURCE_BINDING_SIGNAL_UNSERVED,
	TELEMETRY_SOURCE_BINDING_ENVIRONMENT_MISMATCH,
	TELEMETRY_SOURCE_INVALID_SIGNAL,
	TELEMETRY_SOURCE_AI_VALIDATION_UNSUPPORTED,
} from "@/constants/messages/en";
import { normalizeDatasourceEndpointUrl } from "./platform/connectors/datasource/http/endpoint-url";
import { clearQueryCache } from "./platform/connectors/datasource/http/cache";
import { invalidateSourceSecretCache } from "./platform/connectors/datasource/http/secret";
import { getDBConfigByUser } from "@/lib/db-config";
import type { DatabaseConfig } from "@prisma/client";

/** Strip connector-registry `telemetry:` prefixes down to the TelemetrySource id. */
export function normalizeTelemetrySourceId(sourceId: string): string {
	let id = String(sourceId || "").trim();
	while (id.startsWith("telemetry:")) {
		id = id.slice("telemetry:".length);
	}
	return id;
}

const ALL_SIGNALS: Signal[] = ["traces", "logs", "metrics", "intelligence"];

function validateSignal(signal: unknown): Signal {
	const s = String(signal || "").trim();
	if (!ALL_SIGNALS.includes(s as Signal)) {
		throw new Error(TELEMETRY_SOURCE_INVALID_SIGNAL(String(signal)));
	}
	return s as Signal;
}

export interface TelemetrySourceInput {
	name?: unknown;
	environment?: unknown;
	type?: unknown;
	signals?: unknown;
	settings?: unknown;
	secretRef?: unknown;
	/**
	 * Inline credentials (e.g. `{ apiKey, appKey }` or `{ token }`). When
	 * present and non-empty, the server persists them as an `openlit_vault`
	 * secret and stores only the returned secret id as `secretRef`. Raw
	 * credentials are never stored on the source row and never returned to the
	 * client.
	 */
	credentials?: unknown;
	isDefault?: unknown;
}

/**
 * Persist inline credentials to the vault and return the new secret id.
 * Returns undefined when no non-empty credential values are supplied. Blank
 * values are stripped so an empty edit never overwrites stored credentials.
 */
async function credentialsToSecretRef(
	credentials: unknown,
	sourceName: string,
	type: string
): Promise<string | undefined> {
	if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) {
		return undefined;
	}
	const entries = Object.entries(credentials as Record<string, unknown>).filter(
		([, v]) => typeof v === "string" && v.trim() !== ""
	);
	if (entries.length === 0) return undefined;
	const value = JSON.stringify(Object.fromEntries(entries));
	const key = `telemetry-source/${type}/${sourceName}/${randomUUID().slice(0, 8)}`;
	const result = (await upsertSecret({ key, value })) as
		| { id?: string }
		| string;
	const id = typeof result === "object" ? result?.id : undefined;
	return id || undefined;
}

/** Resolve the caller's current project id, enforcing membership. */
async function requireCurrentProjectId(): Promise<string> {
	const org = await getCurrentOrganisation();
	if (!org?.id) throw new Error(TELEMETRY_SOURCE_NO_PROJECT);
	const project = await getCurrentProjectForOrganisation(org.id);
	if (!project?.id) throw new Error(TELEMETRY_SOURCE_NO_PROJECT);
	return project.id;
}

/** Drop the vault secret reference from an API-facing row. */
function sanitize(row: TelemetrySource) {
	const { secretRef, ...rest } = row;
	return { ...rest, hasSecret: !!secretRef };
}

function normalizeEnvironment(value: unknown): string {
	const environment = String(value || "production").trim().toLowerCase();
	if (!/^[a-z0-9][a-z0-9._-]{0,62}$/.test(environment)) {
		throw new Error("Environment must use letters, numbers, dots, hyphens, or underscores.");
	}
	return environment;
}

/** Drop adapter query/secret caches after routing or credential changes. */
function invalidateTelemetryReadCaches(secretRef?: string | null) {
	clearQueryCache();
	invalidateSourceSecretCache(secretRef || undefined);
}

function rawSignals(signals: unknown): Signal[] {
	if (Array.isArray(signals)) return parseSignals(signals.join(","));
	if (typeof signals === "string") return parseSignals(signals);
	return parseSignals(undefined);
}

/**
 * Normalize the requested signals for a source type, enforcing that they are a
 * subset of the type's declared signals. When the caller did not specify any
 * signals, defaults to the type's full declared set. Throws when the caller
 * explicitly asked for a signal the type cannot serve.
 */
function normalizeSignalsForType(signals: unknown, type: string): string {
	const declared = getSourceTypeDescriptor(type)?.declaredSignals ?? [
		"traces",
		"logs",
		"metrics",
	];
	const declaredSet = new Set<string>(declared);
	// No explicit request -> default to the type's declared signals.
	if (signals === undefined || signals === null || signals === "") {
		return declared.join(",");
	}
	const requested = rawSignals(signals);
	const invalid = requested.filter((s) => !declaredSet.has(s));
	if (invalid.length > 0) {
		throw new Error(
			TELEMETRY_SOURCE_SIGNAL_NOT_IN_TYPE(invalid.join(", "), type)
		);
	}
	const allowed = requested.filter((s) => declaredSet.has(s));
	if (allowed.length === 0) throw new Error(TELEMETRY_SOURCE_NO_SIGNALS);
	return allowed.join(",");
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
		// Validate it parses to an object.
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

async function validateSecretReference(secretRef: string | null) {
	if (!secretRef) return;
	const result = await getSecretById(secretRef);
	if (!(result.data as unknown[] | undefined)?.length) {
		throw new Error("The selected vault secret is not owned by the current user.");
	}
}

function validateType(type: unknown): string {
	ensureAdaptersRegistered();
	const t = String(type || "").trim();
	if (!t || !hasAdapterFactory(t)) {
		throw new Error(TELEMETRY_SOURCE_TYPE_UNKNOWN(String(type)));
	}
	// Only registered datasource connector types can be created.
	if (getSourceTypeDescriptor(t)?.internal) {
		throw new Error(TELEMETRY_SOURCE_TYPE_UNKNOWN(t));
	}
	return t;
}

function isUniqueConstraintError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error || "");
	const code =
		typeof error === "object" && error && "code" in error
			? String((error as { code?: unknown }).code || "")
			: "";
	return (
		code === "P2002" ||
		message.includes("Unique constraint failed") ||
		message.includes("unique constraint")
	);
}

/** List all telemetry sources in the current project (secrets stripped). */
export async function listTelemetrySources() {
	const projectId = await requireCurrentProjectId();
	const rows = await prisma.telemetrySource.findMany({
		where: { projectId },
		orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
	});
	return rows.map(sanitize);
}

/** The adapter source types this build can serve (atomic types only). */
export function availableSourceTypes(): string[] {
	ensureAdaptersRegistered();
	return listSourceTypeDescriptors().map((d) => d.type);
}

/** Full static descriptors for the atomic source types this build can serve. */
export function availableSourceTypeDescriptors() {
	ensureAdaptersRegistered();
	return listSourceTypeDescriptors().map((descriptor) => ({
		...descriptor,
		description: descriptor.description || connectorDescription(descriptor.type, descriptor.displayName),
		icon: descriptor.icon || connectorIconPath(descriptor.type),
	}));
}

/** Resolved per-signal capabilities for the active project's routed sources. */
export interface ResolvedSignalCapability {
	sourceType: string;
	sourceName: string;
	isBuiltIn: boolean;
	capabilities: Omit<SourceCapabilities, "signals"> | null;
}

/**
 * Resolve the concrete, per-signal capability profile for the current project's
 * routed sources. The UI uses this to gate surfaces honestly (Grafana-style):
 * e.g. hide the trace tree or aggregation ops a bound source cannot serve
 * rather than erroring. Resolution mirrors query routing (binding -> default ->
 * built-in) and never throws for a single signal — an unresolvable signal is
 * reported as `null` capabilities.
 */
export async function resolveProjectSignalCapabilities(
	environment?: string
): Promise<Record<Signal, ResolvedSignalCapability | null>> {
	ensureAdaptersRegistered();
	const out = {} as Record<Signal, ResolvedSignalCapability | null>;
	for (const signal of ALL_SIGNALS) {
		try {
			const descriptor = await resolveTelemetrySourceDescriptor({
				signal,
				environment,
			});
			const adapter = createAdapter(descriptor);
			const caps = adapter ? adapter.capabilities() : null;
			out[signal] = {
				sourceType: descriptor.type,
				sourceName: descriptor.name,
				isBuiltIn:
					descriptor.isBuiltIn || descriptor.type === "clickhouse",
				capabilities: caps
					? (() => {
							// Drop the per-instance `signals` list; the UI keys off
							// the capability booleans only.
							const { signals: _signals, ...rest } = caps;
							return rest;
						})()
					: null,
			};
		} catch {
			out[signal] = null;
		}
	}
	return out;
}

/** Create a project-scoped telemetry source. */
export async function createTelemetrySource(input: TelemetrySourceInput) {
	const projectId = await requireCurrentProjectId();
	const name = String(input.name || "").trim();
	if (!name) throw new Error(TELEMETRY_SOURCE_NAME_REQUIRED);
	const type = validateType(input.type);
	await assertPremiumConnectorAllowed(type);
	const environment = normalizeEnvironment(input.environment);
	await createProjectEnvironment(environment);
	const signals = normalizeSignalsForType(input.signals, type);
	const settings = normalizeSettings(input.settings);
	const isDefault = input.isDefault === true;
	const credentialSecretRef = await credentialsToSecretRef(
		input.credentials,
		name,
		type
	);
	const secretRef =
		credentialSecretRef ??
		(typeof input.secretRef === "string" ? input.secretRef : null);
	await validateSecretReference(secretRef);

	const existing = await prisma.telemetrySource.findFirst({
		where: { projectId, name, environment },
		select: { id: true },
	});
	if (existing) {
		throw new Error(TELEMETRY_SOURCE_NAME_TAKEN(name, environment));
	}

	try {
		const row = await prisma.$transaction(async (tx) => {
			if (isDefault) {
				await tx.telemetrySource.updateMany({
					where: { projectId, isDefault: true },
					data: { isDefault: false },
				});
			}
			const created = await tx.telemetrySource.create({
				data: {
					projectId,
					name,
					environment,
					type,
					signals,
					settings,
					secretRef,
					isDefault,
				},
			});
			await tx.connectorInstance.upsert({
				where: { id: `telemetry:${created.id}` },
				create: {
					id: `telemetry:${created.id}`,
					category: "datasource",
					type: created.type,
					name: created.name,
					environment: created.environment || "production",
					projectId: created.projectId,
					settings: created.settings || "{}",
					secretRef: created.secretRef,
					status: "active",
					metadata: JSON.stringify({
						legacyKind: "telemetry-source",
						legacyId: created.id,
						signals: created.signals,
						isDefault: created.isDefault,
					}),
				},
				update: {
					type: created.type,
					name: created.name,
					environment: created.environment || "production",
					projectId: created.projectId,
					settings: created.settings || "{}",
					secretRef: created.secretRef,
					status: "active",
					metadata: JSON.stringify({
						legacyKind: "telemetry-source",
						legacyId: created.id,
						signals: created.signals,
						isDefault: created.isDefault,
					}),
				},
			});
			return created;
		});
		invalidateTelemetryReadCaches(row.secretRef);
		return sanitize(row);
	} catch (error) {
		if (isUniqueConstraintError(error)) {
			throw new Error(TELEMETRY_SOURCE_NAME_TAKEN(name, environment));
		}
		throw error;
	}
}

async function requireSourceInProject(id: string): Promise<TelemetrySource> {
	const projectId = await requireCurrentProjectId();
	const row = await prisma.telemetrySource.findFirst({
		where: { id: normalizeTelemetrySourceId(id), projectId },
	});
	if (!row) throw new Error(TELEMETRY_SOURCE_NOT_FOUND);
	return row;
}

/** Update a telemetry source that belongs to the current project. */
export async function updateTelemetrySource(
	id: string,
	input: TelemetrySourceInput
) {
	const existing = await requireSourceInProject(id);
	const data: Record<string, unknown> = {};
	if (input.name !== undefined) {
		const name = String(input.name || "").trim();
		if (!name) throw new Error(TELEMETRY_SOURCE_NAME_REQUIRED);
		data.name = name;
	}
	if (input.environment !== undefined) {
		data.environment = normalizeEnvironment(input.environment);
		await createProjectEnvironment(data.environment);
	}
	const effectiveType =
		input.type !== undefined ? validateType(input.type) : existing.type;
	if (input.type !== undefined) {
		await assertPremiumConnectorAllowed(effectiveType);
		data.type = effectiveType;
	}
	if (input.signals !== undefined) {
		data.signals = normalizeSignalsForType(input.signals, effectiveType);
	} else if (input.type !== undefined) {
		// Type changed but signals not provided: re-validate stored signals
		// against the new type's declared set, dropping any it cannot serve.
		data.signals = normalizeSignalsForType(existing.signals, effectiveType);
	}
	if (input.settings !== undefined) data.settings = normalizeSettings(input.settings);
	// Inline credentials take precedence: persist them to the vault and repoint
	// secretRef. Blank credentials are ignored so an edit that leaves the
	// credential fields empty keeps the existing secret.
	const effectiveName =
		typeof data.name === "string" ? (data.name as string) : existing.name;
	const credentialSecretRef = await credentialsToSecretRef(
		input.credentials,
		effectiveName,
		effectiveType
	);
	if (credentialSecretRef) {
		data.secretRef = credentialSecretRef;
	} else if (input.secretRef !== undefined) {
		data.secretRef =
			typeof input.secretRef === "string" ? input.secretRef : null;
	}
	await validateSecretReference(
		(data.secretRef as string | null | undefined) ?? existing.secretRef
	);
	const makeDefault = input.isDefault === true;

	const row = await prisma.$transaction(async (tx) => {
		if (makeDefault) {
			await tx.telemetrySource.updateMany({
				where: {
					projectId: existing.projectId,
					isDefault: true,
					NOT: { id },
				},
				data: { isDefault: false },
			});
			data.isDefault = true;
		} else if (input.isDefault === false) {
			data.isDefault = false;
		}
		return tx.telemetrySource.update({ where: { id }, data });
	});
	await syncTelemetrySourceConnector(row);
	invalidateTelemetryReadCaches(
		(data.secretRef as string | null | undefined) ?? row.secretRef
	);
	return sanitize(row);
}

/** Delete a telemetry source that belongs to the current project. */
export async function deleteTelemetrySource(id: string) {
	const existing = await requireSourceInProject(id);
	await prisma.telemetrySource.delete({ where: { id } });
	await removeLegacyConnector("telemetry-source", id);
	invalidateTelemetryReadCaches(existing.secretRef);
	return { id };
}

async function adapterForSource(row: TelemetrySource) {
	ensureAdaptersRegistered();
	// Vault secrets for connectors are scoped by the active database config.
	// Interactive reads attach this in resolveSignalSource; health/test must too.
	const activeDatabase = (await getDBConfigByUser(true)) as
		| DatabaseConfig
		| null
		| undefined;
	const descriptor = {
		...toDescriptor(row),
		...(activeDatabase?.id ? { dbConfigId: activeDatabase.id } : {}),
	};
	return createAdapter(descriptor);
}

/** Health-check a telemetry source by binding its adapter. */
export async function healthCheckTelemetrySource(
	id: string
): Promise<HealthCheckResult> {
	const row = await requireSourceInProject(id);
	await assertPremiumConnectorAllowed(row.type);
	const adapter = await adapterForSource(row);
	if (!adapter) {
		return { ok: false, message: TELEMETRY_SOURCE_TYPE_UNKNOWN(row.type) };
	}
	return adapter.healthCheck();
}

/** Probe a telemetry source for AI telemetry over a window. */
export async function validateTelemetrySourceAISignal(
	id: string,
	window: QueryTimeRange
): Promise<AISignalValidation> {
	const row = await requireSourceInProject(id);
	const adapter = await adapterForSource(row);
	if (!adapter) {
		return {
			ok: false,
			sampleCount: 0,
			missingAttributes: [],
			supported: false,
			message: TELEMETRY_SOURCE_TYPE_UNKNOWN(row.type),
		};
	}
	try {
		const result = await adapter.validateAISignal(window);
		return { supported: true, ...result };
	} catch (err) {
		// Logs/metrics-only sources (Loki, Mimir, …) correctly refuse AI-span
		// validation. Test-connection must still succeed on health alone.
		if (err instanceof UnsupportedCapabilityError) {
			return {
				ok: true,
				sampleCount: 0,
				missingAttributes: [],
				supported: false,
				message: TELEMETRY_SOURCE_AI_VALIDATION_UNSUPPORTED(row.type),
			};
		}
		throw err;
	}
}

// ---- Per-signal bindings (Grafana-style per-signal routing) --------------

function publicBindingSourceId(row: {
	sourceId: string | null;
	databaseConfigId: string | null;
} | null | undefined): string | null {
	if (!row) return null;
	if (row.sourceId) return row.sourceId;
	if (row.databaseConfigId) return `builtin:${row.databaseConfigId}`;
	return null;
}

function bindingSourceType(row: {
	sourceId: string | null;
	databaseConfigId: string | null;
	source?: { type: string } | null;
} | null | undefined): string | null {
	if (!row) return null;
	if (row.source?.type) return row.source.type;
	if (row.databaseConfigId) return "clickhouse";
	return null;
}

/** List the current project's per-signal source bindings. */
export async function listTelemetrySourceBindings(environmentInput?: unknown) {
	const projectId = await requireCurrentProjectId();
	const environment = normalizeEnvironment(environmentInput);
	const rows = await prisma.telemetrySourceBinding.findMany({
		where: { projectId, environment },
		include: { source: true, databaseConfig: true },
		orderBy: { signal: "asc" },
	});
	return rows.map((b) => ({
		id: b.id,
		signal: b.signal,
		sourceId: b.sourceId || (b.databaseConfigId ? `builtin:${b.databaseConfigId}` : ""),
		sourceName: b.source?.name ?? b.databaseConfig?.name ?? null,
		sourceType: b.source?.type ?? "clickhouse",
		environment: b.environment,
	}));
}

/**
 * Bind a signal to a source in the current project. Enforces membership, that
 * the source belongs to the project, and that the source actually serves the
 * signal (never bind a signal to a source that cannot serve it).
 */
export async function setTelemetrySourceBinding(
	signalInput: unknown,
	sourceId: string,
	environmentInput?: unknown
) {
	const projectId = await requireCurrentProjectId();
	const signal = validateSignal(signalInput);
	const environment = normalizeEnvironment(environmentInput);
	const existing = await prisma.telemetrySourceBinding.findUnique({
		where: { projectId_signal_environment: { projectId, signal, environment } },
		include: { source: true },
	});
	const previousSourceId = publicBindingSourceId(existing);
	const previousSourceType = bindingSourceType(existing);
	const normalizedSourceId = sourceId.startsWith("builtin:")
		? sourceId
		: normalizeTelemetrySourceId(sourceId);
	const source = await prisma.telemetrySource.findFirst({
		where: { id: normalizedSourceId, projectId },
	});
	if (!source && normalizedSourceId.startsWith("builtin:")) {
		const databaseConfigId = normalizedSourceId.slice("builtin:".length);
		const databaseConfig = await prisma.databaseConfig.findFirst({
			where: { id: databaseConfigId, projectId },
		});
		if (!databaseConfig) throw new Error(TELEMETRY_SOURCE_NOT_FOUND);
		const dbEnvironment = normalizeEnvironment(databaseConfig.environment);
		if (dbEnvironment !== environment) {
			throw new Error(
				TELEMETRY_SOURCE_BINDING_ENVIRONMENT_MISMATCH(
					databaseConfig.name,
					dbEnvironment,
					environment
				)
			);
		}
		const binding = await prisma.telemetrySourceBinding.upsert({
			where: { projectId_signal_environment: { projectId, signal, environment } },
			create: { projectId, signal, environment, sourceId: null, databaseConfigId },
			update: { sourceId: null, databaseConfigId },
		});
		invalidateTelemetryReadCaches();
		return {
			id: binding.id,
			signal: binding.signal,
			sourceId: normalizedSourceId,
			environment,
			previousSourceId,
			previousSourceType,
			nextSourceType: "clickhouse",
		};
	}
	if (!source) throw new Error(TELEMETRY_SOURCE_NOT_FOUND);
	await assertPremiumConnectorAllowed(source.type);
	const sourceEnvironment = normalizeEnvironment(source.environment);
	if (sourceEnvironment !== environment) {
		throw new Error(
			TELEMETRY_SOURCE_BINDING_ENVIRONMENT_MISMATCH(
				source.name,
				sourceEnvironment,
				environment
			)
		);
	}
	if (!parseSignals(source.signals).includes(signal)) {
		throw new Error(
			TELEMETRY_SOURCE_BINDING_SIGNAL_UNSERVED(signal, source.name)
		);
	}
	const binding = await prisma.telemetrySourceBinding.upsert({
		where: { projectId_signal_environment: { projectId, signal, environment } },
		create: {
			projectId,
			signal,
			environment,
			sourceId: normalizedSourceId,
			databaseConfigId: null,
		},
		update: { sourceId: normalizedSourceId, databaseConfigId: null },
	});
	invalidateTelemetryReadCaches(source.secretRef);
	return {
		id: binding.id,
		signal: binding.signal,
		sourceId: binding.sourceId,
		environment: binding.environment,
		previousSourceId,
		previousSourceType,
		nextSourceType: source.type,
	};
}

/** Remove a signal binding, reverting that signal to capability/built-in routing. */
export async function deleteTelemetrySourceBinding(signalInput: unknown, environmentInput?: unknown) {
	const projectId = await requireCurrentProjectId();
	const signal = validateSignal(signalInput);
	const environment = normalizeEnvironment(environmentInput);
	const existing = await prisma.telemetrySourceBinding.findFirst({
		where: { projectId, signal, environment },
		include: { source: true },
	});
	const previousSourceId = publicBindingSourceId(existing);
	const previousSourceType = bindingSourceType(existing);
	await prisma.telemetrySourceBinding.deleteMany({
		where: { projectId, signal, environment },
	});
	invalidateTelemetryReadCaches();
	return { signal, environment, previousSourceId, previousSourceType };
}
