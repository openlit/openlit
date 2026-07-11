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
import {
	getCurrentOrganisation,
	getCurrentProjectForOrganisation,
} from "./organisation";
import { upsertSecret } from "./platform/vault";
import {
	parseSignals,
	toDescriptor,
	resolveTelemetrySourceDescriptor,
} from "./telemetry-source";
import { ensureAdaptersRegistered } from "./platform/datasource/bootstrap";
import {
	createAdapter,
	getSourceTypeDescriptor,
	hasAdapterFactory,
	listSourceTypeDescriptors,
} from "./platform/datasource/registry";
import type { TelemetrySource } from "@prisma/client";
import type {
	AISignalValidation,
	HealthCheckResult,
	QueryTimeRange,
	Signal,
	SourceCapabilities,
} from "./platform/datasource/types";
import { UnsupportedCapabilityError } from "./platform/datasource/types";
import {
	TELEMETRY_SOURCE_NAME_REQUIRED,
	TELEMETRY_SOURCE_TYPE_UNKNOWN,
	TELEMETRY_SOURCE_NO_PROJECT,
	TELEMETRY_SOURCE_NOT_FOUND,
	TELEMETRY_SOURCE_INVALID_SETTINGS,
	TELEMETRY_SOURCE_SIGNAL_NOT_IN_TYPE,
	TELEMETRY_SOURCE_NO_SIGNALS,
	TELEMETRY_SOURCE_BINDING_SIGNAL_UNSERVED,
	TELEMETRY_SOURCE_INVALID_SIGNAL,
	TELEMETRY_SOURCE_STACK_NO_MEMBERS,
	TELEMETRY_SOURCE_AI_VALIDATION_UNSUPPORTED,
} from "@/constants/messages/en";

const ALL_SIGNALS: Signal[] = ["traces", "logs", "metrics"];

function validateSignal(signal: unknown): Signal {
	const s = String(signal || "").trim();
	if (!ALL_SIGNALS.includes(s as Signal)) {
		throw new Error(TELEMETRY_SOURCE_INVALID_SIGNAL(String(signal)));
	}
	return s as Signal;
}

export interface TelemetrySourceInput {
	name?: unknown;
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

function normalizeSettings(settings: unknown): string {
	if (settings === undefined || settings === null) return "{}";
	if (typeof settings === "string") {
		// Validate it parses to an object.
		try {
			const parsed = JSON.parse(settings);
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
				throw new Error(TELEMETRY_SOURCE_INVALID_SETTINGS);
			}
			return settings;
		} catch {
			throw new Error(TELEMETRY_SOURCE_INVALID_SETTINGS);
		}
	}
	if (typeof settings === "object" && !Array.isArray(settings)) {
		return JSON.stringify(settings);
	}
	throw new Error(TELEMETRY_SOURCE_INVALID_SETTINGS);
}

function validateType(type: unknown): string {
	ensureAdaptersRegistered();
	const t = String(type || "").trim();
	if (!t || !hasAdapterFactory(t)) {
		throw new Error(TELEMETRY_SOURCE_TYPE_UNKNOWN(String(type)));
	}
	// Internal "stack" umbrella types (grafana/victoria) are not created as
	// atomic rows directly; they are expanded via createSourceStack().
	if (getSourceTypeDescriptor(t)?.internal) {
		throw new Error(TELEMETRY_SOURCE_TYPE_UNKNOWN(t));
	}
	return t;
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
	return listSourceTypeDescriptors();
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
export async function resolveProjectSignalCapabilities(): Promise<
	Record<Signal, ResolvedSignalCapability | null>
> {
	ensureAdaptersRegistered();
	const out = {} as Record<Signal, ResolvedSignalCapability | null>;
	for (const signal of ALL_SIGNALS) {
		try {
			const descriptor = await resolveTelemetrySourceDescriptor({ signal });
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

	const row = await prisma.$transaction(async (tx) => {
		if (isDefault) {
			await tx.telemetrySource.updateMany({
				where: { projectId, isDefault: true },
				data: { isDefault: false },
			});
		}
		return tx.telemetrySource.create({
			data: {
				projectId,
				name,
				type,
				signals,
				settings,
				secretRef,
				isDefault,
			},
		});
	});
	return sanitize(row);
}

async function requireSourceInProject(id: string): Promise<TelemetrySource> {
	const projectId = await requireCurrentProjectId();
	const row = await prisma.telemetrySource.findFirst({
		where: { id, projectId },
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
	const effectiveType =
		input.type !== undefined ? validateType(input.type) : existing.type;
	if (input.type !== undefined) data.type = effectiveType;
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
	return sanitize(row);
}

/** Delete a telemetry source that belongs to the current project. */
export async function deleteTelemetrySource(id: string) {
	await requireSourceInProject(id);
	await prisma.telemetrySource.delete({ where: { id } });
	return { id };
}

/** Health-check a telemetry source by binding its adapter. */
export async function healthCheckTelemetrySource(
	id: string
): Promise<HealthCheckResult> {
	const row = await requireSourceInProject(id);
	ensureAdaptersRegistered();
	const adapter = createAdapter(toDescriptor(row));
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
	ensureAdaptersRegistered();
	const adapter = createAdapter(toDescriptor(row));
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

/** List the current project's per-signal source bindings. */
export async function listTelemetrySourceBindings() {
	const projectId = await requireCurrentProjectId();
	const rows = await prisma.telemetrySourceBinding.findMany({
		where: { projectId },
		include: { source: true },
		orderBy: { signal: "asc" },
	});
	return rows.map((b) => ({
		id: b.id,
		signal: b.signal,
		sourceId: b.sourceId,
		sourceName: b.source?.name ?? null,
		sourceType: b.source?.type ?? null,
	}));
}

/**
 * Bind a signal to a source in the current project. Enforces membership, that
 * the source belongs to the project, and that the source actually serves the
 * signal (never bind a signal to a source that cannot serve it).
 */
export async function setTelemetrySourceBinding(
	signalInput: unknown,
	sourceId: string
) {
	const projectId = await requireCurrentProjectId();
	const signal = validateSignal(signalInput);
	const source = await prisma.telemetrySource.findFirst({
		where: { id: sourceId, projectId },
	});
	if (!source) throw new Error(TELEMETRY_SOURCE_NOT_FOUND);
	if (!parseSignals(source.signals).includes(signal)) {
		throw new Error(
			TELEMETRY_SOURCE_BINDING_SIGNAL_UNSERVED(signal, source.name)
		);
	}
	const binding = await prisma.telemetrySourceBinding.upsert({
		where: { projectId_signal: { projectId, signal } },
		create: { projectId, signal, sourceId },
		update: { sourceId },
	});
	return {
		id: binding.id,
		signal: binding.signal,
		sourceId: binding.sourceId,
	};
}

/** Remove a signal binding, reverting that signal to capability/built-in routing. */
export async function deleteTelemetrySourceBinding(signalInput: unknown) {
	const projectId = await requireCurrentProjectId();
	const signal = validateSignal(signalInput);
	await prisma.telemetrySourceBinding.deleteMany({
		where: { projectId, signal },
	});
	return { signal };
}

// ---- Stack templates (descriptor-driven umbrellas -> "create N rows") ------

/**
 * List available stack templates for the UI. Derived from the internal
 * umbrella descriptors (grafana/victoria) that declare a `stackTemplate`, so a
 * new umbrella needs only a descriptor in `stacks.ts` — no edits here.
 */
export function listStackTemplates() {
	ensureAdaptersRegistered();
	return listSourceTypeDescriptors({ includeInternal: true })
		.filter((d) => d.internal && d.stackTemplate)
		.map((d) => ({
			template: d.type,
			displayName: d.stackTemplate!.displayName,
			slots: d.stackTemplate!.slots,
		}));
}

export interface StackMemberInput {
	type: unknown;
	name?: unknown;
	signals?: unknown;
	settings?: unknown;
	secretRef?: unknown;
	/** Inline credentials persisted to the vault (see TelemetrySourceInput). */
	credentials?: unknown;
	/** Bind this member's signals as the project routing (default true). */
	bind?: unknown;
}

export interface CreateSourceStackInput {
	/** Base name; each member is named "<name> - <type>" when unnamed. */
	name?: unknown;
	/** Atomic member sources to create. */
	members?: unknown;
	/** Bind every member's signals as project routing (default true). */
	bind?: unknown;
}

/**
 * Create a set of atomic sources in one action and (by default) bind each
 * member's signals as the project's per-signal routing. Runs in a single
 * transaction so a partial stack is never persisted. Later members override
 * earlier ones for a shared signal binding.
 */
export async function createSourceStack(input: CreateSourceStackInput) {
	const projectId = await requireCurrentProjectId();
	const baseName = String(input.name || "").trim();
	if (!baseName) throw new Error(TELEMETRY_SOURCE_NAME_REQUIRED);
	if (!Array.isArray(input.members) || input.members.length === 0) {
		throw new Error(TELEMETRY_SOURCE_STACK_NO_MEMBERS);
	}
	const bindDefault = input.bind !== false;

	// Validate/normalize every member up front (throws before any write).
	// Credentials are persisted to the vault before the DB transaction so a
	// failed vault write never leaves a half-created stack.
	const prepared = await Promise.all(
		(input.members as StackMemberInput[]).map(async (m) => {
			const type = validateType(m.type);
			const signals = normalizeSignalsForType(m.signals, type);
			const settings = normalizeSettings(m.settings);
			const name = String(m.name || "").trim() || `${baseName} - ${type}`;
			const credentialSecretRef = await credentialsToSecretRef(
				m.credentials,
				name,
				type
			);
			return {
				type,
				signals,
				settings,
				name,
				secretRef:
					credentialSecretRef ??
					(typeof m.secretRef === "string" ? m.secretRef : null),
				bind: m.bind !== false,
			};
		})
	);

	const result = await prisma.$transaction(async (tx) => {
		const created: { id: string; type: string; signals: string; name: string }[] =
			[];
		for (const m of prepared) {
			const row = await tx.telemetrySource.create({
				data: {
					projectId,
					name: m.name,
					type: m.type,
					signals: m.signals,
					settings: m.settings,
					secretRef: m.secretRef,
					isDefault: false,
				},
			});
			created.push({ id: row.id, type: row.type, signals: row.signals, name: row.name });

			if (bindDefault && m.bind) {
				for (const signal of parseSignals(row.signals)) {
					await tx.telemetrySourceBinding.upsert({
						where: { projectId_signal: { projectId, signal } },
						create: { projectId, signal, sourceId: row.id },
						update: { sourceId: row.id },
					});
				}
			}
		}
		return created;
	});

	return { sources: result.map((r) => ({ id: r.id, type: r.type, name: r.name })) };
}
