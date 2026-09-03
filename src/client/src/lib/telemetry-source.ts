/**
 * Telemetry source resolution (CE).
 *
 * Resolves which raw-telemetry source should power a read:
 *   1. An explicit source id (must belong to the caller's current project).
 *   2. The project's per-signal binding / default `TelemetrySource`.
 *   3. The implicit built-in ClickHouse source (the project `DatabaseConfig`).
 *
 * Adapters for external vendors are registered in CE. Product surfaces still
 * need to call into this resolver (and the adapter) to leave ClickHouse —
 * configuring a source alone does not reroute Telemetry/Agents/Evals.
 */

import prisma from "./prisma";
import {
	getDBConfigByUser,
	getDBConfigById,
	getDBConfigByIdInternal,
} from "@/lib/db-config";
import {
	getCurrentOrganisation,
	getCurrentProjectForOrganisation,
} from "@/lib/organisation";
import { OPENLIT_CONTEXT_HEADERS } from "@/constants/openlit-context";
import { MIDDLEWARE_DATABASE_CONFIG_HEADER } from "@/helpers/server/auth";
import { headers } from "next/headers";
import type { DatabaseConfig, TelemetrySource } from "@prisma/client";
import type {
	DataSourceAdapter,
	Signal,
	TelemetrySourceDescriptor,
} from "./platform/connectors/datasource/types";
import { ensureAdaptersRegistered } from "./platform/connectors/datasource/bootstrap";
import { createAdapter } from "./platform/connectors/datasource/registry";
import { consoleLog } from "@/utils/log";

const ALL_SIGNALS: Signal[] = ["traces", "logs", "metrics", "intelligence"];
const VALID_SIGNALS = new Set<string>(ALL_SIGNALS);

/** Parse the comma-separated `signals` column into a typed list. */
export function parseSignals(raw: string | null | undefined): Signal[] {
	if (!raw) return [...ALL_SIGNALS];
	const parsed = raw
		.split(",")
		.map((s) => s.trim())
		.filter((s): s is Signal => VALID_SIGNALS.has(s));
	return parsed.length > 0 ? parsed : [...ALL_SIGNALS];
}

/** Safely parse the JSON `settings` column. */
export function parseSettings(raw: string | null | undefined): Record<string, unknown> {
	if (!raw) return {};
	try {
		const value = JSON.parse(raw);
		return value && typeof value === "object" ? value : {};
	} catch {
		return {};
	}
}

/** Build the implicit built-in ClickHouse descriptor from a DatabaseConfig. */
export function builtInDescriptor(
	dbConfig: Pick<DatabaseConfig, "id" | "name" | "projectId" | "environment">
): TelemetrySourceDescriptor {
	return {
		type: "clickhouse",
		id: `builtin:${dbConfig.id}`,
		isBuiltIn: true,
		settings: {},
		secretRef: null,
		dbConfigId: dbConfig.id,
		signals: [...ALL_SIGNALS],
		projectId: dbConfig.projectId ?? null,
		name: dbConfig.name,
		environment: dbConfig.environment,
	};
}

/** Map a stored TelemetrySource row to a descriptor. */
export function toDescriptor(row: TelemetrySource): TelemetrySourceDescriptor {
	return {
		type: row.type,
		id: row.id,
		isBuiltIn: false,
		settings: parseSettings(row.settings),
		secretRef: row.secretRef,
		signals: parseSignals(row.signals),
		projectId: row.projectId ?? null,
		name: row.name,
		environment: row.environment,
	};
}

async function readRequestContextHeaders(): Promise<{
	projectId?: string;
	databaseConfigId?: string;
}> {
	try {
		const headerStore = await headers();
		return {
			projectId:
				headerStore.get(OPENLIT_CONTEXT_HEADERS.projectId)?.trim() ||
				undefined,
			databaseConfigId:
				headerStore.get(MIDDLEWARE_DATABASE_CONFIG_HEADER)?.trim() ||
				headerStore.get(OPENLIT_CONTEXT_HEADERS.databaseConfigId)?.trim() ||
				undefined,
		};
	} catch {
		return {};
	}
}

async function getCurrentProjectId(): Promise<string | null> {
	const requestContext = await readRequestContextHeaders();
	if (requestContext.projectId) {
		return requestContext.projectId;
	}
	if (requestContext.databaseConfigId) {
		const databaseConfig = await getDBConfigByIdInternal({
			id: requestContext.databaseConfigId,
		});
		if (databaseConfig?.projectId) {
			return databaseConfig.projectId;
		}
	}

	try {
		const currentOrg = await getCurrentOrganisation();
		if (!currentOrg?.id) return null;
		const currentProject = await getCurrentProjectForOrganisation(currentOrg.id);
		return currentProject?.id ?? null;
	} catch {
		return null;
	}
}

async function resolveActiveCredentialDatabase(
	options: ResolveTelemetrySourceOptions
): Promise<DatabaseConfig | null | undefined> {
	if (options.dbConfigId) {
		return getDBConfigByIdInternal({ id: options.dbConfigId });
	}
	if (options.projectId !== undefined) {
		return null;
	}

	const requestContext = await readRequestContextHeaders();
	if (requestContext.databaseConfigId) {
		return getDBConfigByIdInternal({ id: requestContext.databaseConfigId });
	}

	try {
		return (await getDBConfigByUser(true)) as DatabaseConfig | null | undefined;
	} catch {
		return null;
	}
}

export async function resolveBuiltInDescriptor(
	dbConfigId?: string
): Promise<TelemetrySourceDescriptor> {
	let dbConfig: DatabaseConfig | null | undefined;
	if (dbConfigId) {
		dbConfig = await getDBConfigById({ id: dbConfigId });
	} else {
		dbConfig = (await getDBConfigByUser(true)) as DatabaseConfig | undefined;
	}
	if (!dbConfig?.id) {
		// No configured ClickHouse yet — return a descriptor with an empty id so
		// callers can surface "configure a data source" rather than crash.
		return {
			type: "clickhouse",
			id: "builtin:none",
			isBuiltIn: true,
			settings: {},
			secretRef: null,
			dbConfigId: undefined,
			signals: [...ALL_SIGNALS],
			projectId: null,
			name: "ClickHouse",
		};
	}
	return builtInDescriptor(dbConfig);
}

/**
 * Whether a source supports OpenLIT's raw ClickHouse-SQL paths (the
 * natural-language chat / Otter NL feature and raw-SQL custom widgets). Only
 * the built-in ClickHouse source can execute arbitrary SQL against the OTel
 * schema; external sources speak their own query languages and are gated.
 */
export function sourceSupportsNativeSql(
	descriptor: TelemetrySourceDescriptor
): boolean {
	return descriptor.type === "clickhouse";
}

export interface ResolveTelemetrySourceOptions {
	/** A descriptor already resolved by the caller, avoiding duplicate lookup. */
	descriptor?: TelemetrySourceDescriptor;
	/** Environment partition used to select a connector and binding. */
	environment?: string;
	/** Explicit source id override (e.g. dashboard widget `sourceId`). */
	sourceId?: string | null;
	/**
	 * The signal being read. When set, resolution is signal-aware: it follows
	 * the per-signal binding -> capability -> built-in precedence and NEVER
	 * returns a source that does not serve this signal.
	 */
	signal?: Signal;
	/** Backing DatabaseConfig id when resolving the built-in source directly. */
	dbConfigId?: string;
	/** Project id override; defaults to the caller's current project. */
	projectId?: string | null;
}

function normalizeEnvironment(value: unknown): string {
	const environment = String(value || "production").trim().toLowerCase();
	return /^[a-z0-9][a-z0-9._-]{0,62}$/.test(environment)
		? environment
		: "production";
}

/** How a signal's source was chosen (for observability / honest UI). */
export type SignalSourceVia =
	| "override"
	| "binding"
	| "capability"
	| "default"
	| "builtin"
	| "none";

/** Typed result of signal-aware resolution. */
export interface SignalSourceResolution {
	descriptor: TelemetrySourceDescriptor;
	/** True when the resolved source actually serves the requested signal. */
	servesSignal: boolean;
	/** True when a real, reachable source backs this signal (built-in or not). */
	hasSource: boolean;
	via: SignalSourceVia;
}

function descriptorServesSignal(
	descriptor: TelemetrySourceDescriptor,
	signal: Signal
): boolean {
	return descriptor.signals.includes(signal);
}

/**
 * Load a TelemetrySource by id only when it belongs to `projectId`.
 * Cross-project ids must never resolve — that would be an IDOR on the
 * source's endpoint + vault secret.
 */
async function findSourceInProject(
	sourceId: string,
	projectId: string | null | undefined,
	environment?: string
): Promise<TelemetrySource | null> {
	if (!projectId) return null;
	return prisma.telemetrySource.findFirst({
		where: { id: sourceId, projectId, environment: normalizeEnvironment(environment) },
	});
}

/**
 * Signal-aware resolution following Grafana's per-signal datasource model:
 *   1. explicit sourceId override (must belong to the current project)
 *   2. the project's per-signal binding (if it serves the signal)
 *   3. any project source that advertises the signal (default first)
 *   4. the built-in ClickHouse source (serves all signals)
 *   5. a typed "no source" state
 * It never returns a source that lacks the requested signal, and never
 * returns a source from another project.
 */
export async function resolveSignalSource(
	signal: Signal,
	options: ResolveTelemetrySourceOptions = {}
): Promise<SignalSourceResolution> {
	const hasRequestedEnvironment =
		options.environment !== undefined &&
		options.environment !== null &&
		String(options.environment).trim().length > 0;
	const projectId =
		options.projectId !== undefined
			? options.projectId
			: await getCurrentProjectId();
	// External connector secrets live in the active OpenLIT DatabaseConfig's
	// vault. Explicit environment selection must not discard that credential
	// store: doing so makes the adapter fall back to an implicit DB lookup and
	// leaves background/parallel reads unable to resolve authentication
	// consistently. Background callers pass projectId + dbConfigId explicitly;
	// interactive callers can safely resolve the current project-scoped DB.
	// API-key callers use the middleware-bound database config as the vault.
	const activeDatabase = await resolveActiveCredentialDatabase(options);
	const credentialDatabaseConfigId =
		options.dbConfigId || activeDatabase?.id;
	const environment = normalizeEnvironment(options.environment || activeDatabase?.environment || "production");
	const externalDescriptor = (row: TelemetrySource) => ({
		...toDescriptor(row),
		...(credentialDatabaseConfigId
			? { dbConfigId: credentialDatabaseConfigId }
			: {}),
	});

	// 1. Explicit override — project-scoped only (external source or builtin:dbId).
	if (options.sourceId) {
		if (options.sourceId.startsWith("builtin:")) {
			const databaseConfigId = options.sourceId.slice("builtin:".length);
			if (projectId && databaseConfigId) {
				const databaseConfig = await prisma.databaseConfig.findFirst({
					where: {
						id: databaseConfigId,
						projectId,
						...(hasRequestedEnvironment ? { environment } : {}),
					},
				});
				if (databaseConfig) {
					return {
						descriptor: builtInDescriptor(databaseConfig),
						servesSignal: true,
						hasSource: true,
						via: "override",
					};
				}
			}
			consoleLog(
				`resolveSignalSource: builtin sourceId ${options.sourceId} not found in project; continuing`
			);
		} else {
			const row = await findSourceInProject(
				options.sourceId,
				projectId,
				environment
			);
			if (row) {
				const descriptor = externalDescriptor(row);
				return {
					descriptor,
					servesSignal: descriptorServesSignal(descriptor, signal),
					hasSource: true,
					via: "override",
				};
			}
			consoleLog(
				`resolveSignalSource: sourceId ${options.sourceId} not found in project; continuing`
			);
		}
	}

	if (projectId) {
		// 2. Per-signal binding.
		const binding = await prisma.telemetrySourceBinding.findUnique({
			where: { projectId_signal_environment: { projectId, signal, environment } },
			include: { source: true, databaseConfig: true },
		});
		if (binding?.databaseConfig) {
			const descriptor = builtInDescriptor(binding.databaseConfig);
			return { descriptor, servesSignal: true, hasSource: true, via: "binding" };
		}
		if (binding?.source) {
			const descriptor = externalDescriptor(binding.source);
			if (descriptorServesSignal(descriptor, signal)) {
				return { descriptor, servesSignal: true, hasSource: true, via: "binding" };
			}
			consoleLog(
				`resolveSignalSource: binding for ${signal} points at source "${binding.source.name}" which does not serve ${signal}; continuing`
			);
		}

		// Do not pick an arbitrary connector just because it advertises this
		// signal. A connector is active only after an explicit signal binding;
		// otherwise changing environments can silently read another backend.
	}

	// 3. Preserve the legacy implicit ClickHouse behavior only when the caller
	// did not explicitly select an environment. Environment-scoped requests
	// must fail closed when that environment has no routed connector.
	if (hasRequestedEnvironment) {
		return {
			descriptor: {
				type: "clickhouse",
				id: "builtin:none",
				isBuiltIn: true,
				settings: {},
				secretRef: null,
				dbConfigId: undefined,
				signals: [...ALL_SIGNALS],
				projectId,
				name: "ClickHouse",
				environment,
			},
			servesSignal: false,
			hasSource: false,
			via: "none",
		};
	}

	// 4. Built-in ClickHouse (serves all signals when configured).
	const builtin = activeDatabase
		? builtInDescriptor(activeDatabase)
		: await resolveBuiltInDescriptor(options.dbConfigId);
	const hasBuiltin = !!builtin.dbConfigId;
	return {
		descriptor: builtin,
		servesSignal: hasBuiltin,
		hasSource: hasBuiltin,
		via: hasBuiltin ? "builtin" : "none",
	};
}

/**
 * Correlation boundary helper: whether a signal is served by the built-in
 * ClickHouse store (the only source that is fully correlated with the other
 * built-in signals). Cross-signal intelligence that runs natively against
 * OpenLIT's ClickHouse (e.g. enriching trace-derived agent snapshots from
 * `otel_logs`) must consult this and degrade gracefully when the signal lives
 * in a different backend, instead of silently querying the wrong store.
 */
export async function isSignalServedByBuiltInClickHouse(
	signal: Signal,
	options: ResolveTelemetrySourceOptions = {}
): Promise<boolean> {
	const resolution = await resolveSignalSource(signal, options);
	return (
		resolution.hasSource === true &&
		resolution.servesSignal === true &&
		resolution.descriptor.isBuiltIn === true &&
		resolution.descriptor.type === "clickhouse" &&
		Boolean(resolution.descriptor.dbConfigId)
	);
}

/**
 * Resolve the telemetry source descriptor for the current request. When a
 * `signal` is supplied, resolution is signal-aware (see `resolveSignalSource`).
 * Otherwise it follows the legacy precedence (explicit id -> project default ->
 * built-in). Never throws for a missing external source; falls back to the
 * built-in ClickHouse source and logs.
 */
export async function resolveTelemetrySourceDescriptor(
	options: ResolveTelemetrySourceOptions = {}
): Promise<TelemetrySourceDescriptor> {
	if (options.signal) {
		const resolution = await resolveSignalSource(options.signal, options);
		return resolution.descriptor;
	}

	const projectId =
		options.projectId !== undefined
			? options.projectId
			: await getCurrentProjectId();

	// 1. Explicit source id override — project-scoped only (no cross-project IDOR).
	if (options.sourceId) {
		if (options.sourceId.startsWith("builtin:")) {
			const databaseConfigId = options.sourceId.slice("builtin:".length);
			if (projectId && databaseConfigId) {
				const databaseConfig = await prisma.databaseConfig.findFirst({
					where: { id: databaseConfigId, projectId },
				});
				if (databaseConfig) return builtInDescriptor(databaseConfig);
			}
		} else {
			const row = await findSourceInProject(options.sourceId, projectId);
			if (row) return toDescriptor(row);
		}
		consoleLog(
			`resolveTelemetrySource: sourceId ${options.sourceId} not found in project; falling back to default`
		);
	}

	// 2. Current project's default TelemetrySource.
	if (projectId) {
		const row = await prisma.telemetrySource.findFirst({
			where: { projectId, isDefault: true },
			orderBy: { createdAt: "asc" },
		});
		if (row) return toDescriptor(row);
	}

	// 3. Built-in ClickHouse source.
	return resolveBuiltInDescriptor(options.dbConfigId);
}

/**
 * Resolve and bind a concrete telemetry adapter for the current request.
 * Always returns a usable adapter for the built-in ClickHouse path. For an
 * explicitly configured external source, fails closed when no factory is
 * registered — never silently reads the wrong store.
 */
export async function getTelemetryAdapter(
	options: ResolveTelemetrySourceOptions = {}
): Promise<DataSourceAdapter> {
	ensureAdaptersRegistered();
	let resolution: SignalSourceResolution | undefined;
	if (!options.descriptor && options.signal) {
		resolution = await resolveSignalSource(options.signal, options);
	}
	const descriptor =
		options.descriptor ||
		resolution?.descriptor ||
		(await resolveTelemetrySourceDescriptor(options));
	if ((resolution && !resolution.hasSource) || descriptor.id === "builtin:none") {
		const { TELEMETRY_SOURCE_NO_SOURCE_FOR_SIGNAL } = await import(
			"@/constants/messages/en"
		);
		throw new Error(TELEMETRY_SOURCE_NO_SOURCE_FOR_SIGNAL(options.signal!));
	}
	const adapter = createAdapter(descriptor);
	if (adapter) return adapter;

	if (!descriptor.isBuiltIn && descriptor.type !== "clickhouse") {
		const { TELEMETRY_SOURCE_ADAPTER_UNAVAILABLE } = await import(
			"@/constants/messages/en"
		);
		throw new Error(TELEMETRY_SOURCE_ADAPTER_UNAVAILABLE(descriptor.type));
	}

	consoleLog(
		`getTelemetryAdapter: no adapter registered for source type "${descriptor.type}"; falling back to built-in ClickHouse`
	);
	const builtin = await resolveBuiltInDescriptor(options.dbConfigId);
	const fallback = createAdapter(builtin);
	if (!fallback) {
		throw new Error(
			"No telemetry adapter available (built-in ClickHouse factory missing)."
		);
	}
	return fallback;
}

/**
 * Resolve the traces adapter for a DatabaseConfig (cron / materializer path).
 * Uses the config's project bindings rather than the interactive session.
 */
export async function getTelemetryAdapterForDbConfig(
	dbConfigId: string,
	signal: Signal = "traces"
): Promise<{
	adapter: DataSourceAdapter;
	descriptor: TelemetrySourceDescriptor;
	isBuiltIn: boolean;
}> {
	ensureAdaptersRegistered();
	// Cron / job callers have a DatabaseConfig id but no user session.
	// `getDBConfigById` requires getCurrentUser() and throws UNAUTHORIZED_USER,
	// which aborted every materializer tick before Jaeger/Tempo was reached.
	const dbConfig = await getDBConfigByIdInternal({ id: dbConfigId });
	const projectId = dbConfig?.projectId ?? null;
	const resolution = await resolveSignalSource(signal, {
		projectId,
		dbConfigId,
		environment: dbConfig?.environment,
	});
	if (!resolution.hasSource) {
		const { TELEMETRY_SOURCE_NO_SOURCE_FOR_SIGNAL } = await import(
			"@/constants/messages/en"
		);
		throw new Error(TELEMETRY_SOURCE_NO_SOURCE_FOR_SIGNAL(signal));
	}
	// External connector credentials live in the OpenLIT vault table of this
	// DatabaseConfig. Interactive reads can infer that database from session
	// state; cron/materializer reads cannot, so bind it explicitly while keeping
	// the project-scoped source descriptor intact.
	const descriptor = resolution.descriptor.isBuiltIn
		? resolution.descriptor
		: { ...resolution.descriptor, dbConfigId };
	const adapter = createAdapter(descriptor);
	if (!adapter) {
		if (
			!descriptor.isBuiltIn &&
			descriptor.type !== "clickhouse"
		) {
			const { TELEMETRY_SOURCE_ADAPTER_UNAVAILABLE } = await import(
				"@/constants/messages/en"
			);
			throw new Error(
				TELEMETRY_SOURCE_ADAPTER_UNAVAILABLE(descriptor.type)
			);
		}
		const builtin = dbConfig
			? builtInDescriptor(dbConfig)
			: await resolveBuiltInDescriptor(dbConfigId);
		const fallback = createAdapter(builtin);
		if (!fallback) {
			throw new Error(
				"No telemetry adapter available (built-in ClickHouse factory missing)."
			);
		}
		return {
			adapter: fallback,
			descriptor: builtin,
			isBuiltIn: true,
		};
	}
	return {
		adapter,
		descriptor,
		isBuiltIn:
			descriptor.isBuiltIn || descriptor.type === "clickhouse",
	};
}

/**
 * Resolve whether the natural-language SQL chat feature is available for the
 * current request. Chat generates and runs raw ClickHouse SQL, so it is gated
 * to the built-in ClickHouse source; external sources return a finished,
 * explained unsupported state instead of silently failing.
 */
export async function isNativeSqlChatAvailable(
	options: ResolveTelemetrySourceOptions = {}
	): Promise<{
		available: boolean;
		sourceType: string;
		sourceName: string;
		databaseConfigId?: string;
	}> {
	const signal = options.signal || "intelligence";
	const resolution = await resolveSignalSource(signal, options);
	let descriptor = resolution.descriptor;
	// With no explicit environment, preserve the legacy "default source"
	// behavior for an external project default. Otherwise a project with an
	// external telemetry default and no intelligence binding would incorrectly
	// appear to have native SQL available through the fallback ClickHouse DB.
	if (
		!options.environment &&
		resolution.via === "builtin" &&
		descriptor.isBuiltIn &&
		descriptor.dbConfigId
	) {
		const defaultDescriptor = await resolveTelemetrySourceDescriptor({
			...options,
			signal: undefined,
		});
		if (!defaultDescriptor.isBuiltIn && defaultDescriptor.type !== "clickhouse") {
			descriptor = defaultDescriptor;
		}
	}
	const isConfiguredClickHouse =
		descriptor.id !== "builtin:none" &&
		(sourceSupportsNativeSql(descriptor) || descriptor.isBuiltIn) &&
		Boolean(descriptor.dbConfigId);
	return {
		available: isConfiguredClickHouse,
		sourceType: descriptor.type,
		sourceName: descriptor.name,
		databaseConfigId: descriptor.dbConfigId,
	};
}
