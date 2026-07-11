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
import { getDBConfigByUser, getDBConfigById } from "./db-config";
import {
	getCurrentOrganisation,
	getCurrentProjectForOrganisation,
} from "./organisation";
import type { DatabaseConfig, TelemetrySource } from "@prisma/client";
import type {
	DataSourceAdapter,
	Signal,
	TelemetrySourceDescriptor,
} from "./platform/datasource/types";
import { ensureAdaptersRegistered } from "./platform/datasource/bootstrap";
import { createAdapter } from "./platform/datasource/registry";
import { consoleLog } from "@/utils/log";

const ALL_SIGNALS: Signal[] = ["traces", "logs", "metrics"];
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
	dbConfig: Pick<DatabaseConfig, "id" | "name" | "projectId">
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
	};
}

async function getCurrentProjectId(): Promise<string | null> {
	const currentOrg = await getCurrentOrganisation();
	if (!currentOrg?.id) return null;
	const currentProject = await getCurrentProjectForOrganisation(currentOrg.id);
	return currentProject?.id ?? null;
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
	projectId: string | null | undefined
): Promise<TelemetrySource | null> {
	if (!projectId) return null;
	return prisma.telemetrySource.findFirst({
		where: { id: sourceId, projectId },
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
	const projectId =
		options.projectId !== undefined
			? options.projectId
			: await getCurrentProjectId();

	// 1. Explicit override — project-scoped only.
	if (options.sourceId) {
		const row = await findSourceInProject(options.sourceId, projectId);
		if (row) {
			const descriptor = toDescriptor(row);
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

	if (projectId) {
		// 2. Per-signal binding.
		const binding = await prisma.telemetrySourceBinding.findUnique({
			where: { projectId_signal: { projectId, signal } },
			include: { source: true },
		});
		if (binding?.source) {
			const descriptor = toDescriptor(binding.source);
			if (descriptorServesSignal(descriptor, signal)) {
				return { descriptor, servesSignal: true, hasSource: true, via: "binding" };
			}
			consoleLog(
				`resolveSignalSource: binding for ${signal} points at source "${binding.source.name}" which does not serve ${signal}; continuing`
			);
		}

		// 3. Any project source that advertises the signal (default first).
		const rows = await prisma.telemetrySource.findMany({
			where: { projectId },
			orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
		});
		const match = rows.find((r) => parseSignals(r.signals).includes(signal));
		if (match) {
			return {
				descriptor: toDescriptor(match),
				servesSignal: true,
				hasSource: true,
				via: "capability",
			};
		}
	}

	// 4. Built-in ClickHouse (serves all signals when configured).
	const builtin = await resolveBuiltInDescriptor(options.dbConfigId);
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
	return resolution.descriptor.isBuiltIn === true;
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
		const row = await findSourceInProject(options.sourceId, projectId);
		if (row) return toDescriptor(row);
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
	const descriptor = await resolveTelemetrySourceDescriptor(options);
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
	const dbConfig = await getDBConfigById({ id: dbConfigId });
	const projectId = dbConfig?.projectId ?? null;
	const resolution = await resolveSignalSource(signal, {
		projectId,
		dbConfigId,
	});
	const adapter = createAdapter(resolution.descriptor);
	if (!adapter) {
		if (
			!resolution.descriptor.isBuiltIn &&
			resolution.descriptor.type !== "clickhouse"
		) {
			const { TELEMETRY_SOURCE_ADAPTER_UNAVAILABLE } = await import(
				"@/constants/messages/en"
			);
			throw new Error(
				TELEMETRY_SOURCE_ADAPTER_UNAVAILABLE(resolution.descriptor.type)
			);
		}
		const builtin = await resolveBuiltInDescriptor(dbConfigId);
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
		descriptor: resolution.descriptor,
		isBuiltIn:
			resolution.descriptor.isBuiltIn ||
			resolution.descriptor.type === "clickhouse",
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
): Promise<{ available: boolean; sourceType: string; sourceName: string }> {
	const descriptor = await resolveTelemetrySourceDescriptor(options);
	return {
		available: sourceSupportsNativeSql(descriptor),
		sourceType: descriptor.type,
		sourceName: descriptor.name,
	};
}
