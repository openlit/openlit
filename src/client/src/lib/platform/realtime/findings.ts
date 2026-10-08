import type { RealtimeFinding } from "@prisma/client";
import prisma from "@/lib/prisma";
import getMessage from "@/constants/messages";
import { getCurrentOrganisation, getCurrentProjectForOrganisation } from "@/lib/organisation";
import { onRealtimeFinding } from "@/lib/platform/realtime/extension";
import { findActiveRealtimeRule, isWithinRuleScope } from "./rules";
import { isRealtimeMapKey } from "./attributes";
import {
	REALTIME_FINDING_STATES,
	type RealtimeFindingInput,
	type RealtimeFindingState,
	type RealtimeFindingTransition,
	type RealtimeFindingView,
} from "./types";

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const RULE_ID_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;
const ENVIRONMENT_PATTERN = /^[a-z0-9][a-z0-9._-]{0,62}$/;
const DEDUPE_PATTERN = /^[a-f0-9]{16,64}$/;
const MAX_MAP_ENTRIES = 16;
const MAX_MAP_VALUE = 256;

export class RealtimeFindingError extends Error {
	constructor(message: string, readonly status: number) {
		super(message);
	}
}

function invalid(): never {
	throw new RealtimeFindingError(getMessage().REALTIME_FINDING_INVALID, 400);
}

function stringMap(value: unknown): Record<string, string> {
	if (value === undefined || value === null) return {};
	if (typeof value !== "object" || Array.isArray(value)) invalid();
	const entries = Object.entries(value as Record<string, unknown>);
	if (entries.length > MAX_MAP_ENTRIES) invalid();
	const out: Record<string, string> = {};
	for (const [key, raw] of entries) {
		if (!isRealtimeMapKey(key) || typeof raw !== "string") invalid();
		out[key] = raw.slice(0, MAX_MAP_VALUE);
	}
	return out;
}

function finiteNumber(value: unknown, { optional = false } = {}): number | undefined {
	if (value === undefined || value === null) {
		if (optional) return undefined;
		invalid();
	}
	if (typeof value !== "number" || !Number.isFinite(value)) invalid();
	return value;
}

function optionalShortString(value: unknown): string | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	if (typeof value !== "string" || value.length > 64) invalid();
	return value;
}

/** Strictly parse an engine finding payload; throws a 400 error on any mismatch. */
export function parseRealtimeFindingInput(body: unknown): RealtimeFindingInput {
	if (!body || typeof body !== "object" || Array.isArray(body)) invalid();
	const b = body as Record<string, unknown>;
	const str = (v: unknown, pattern: RegExp) => {
		if (typeof v !== "string" || !pattern.test(v)) invalid();
		return v;
	};
	const state = b.state;
	if (!REALTIME_FINDING_STATES.includes(state as RealtimeFindingState)) invalid();
	const observedAt = new Date(typeof b.observedAt === "string" ? b.observedAt : NaN);
	if (Number.isNaN(observedAt.getTime())) invalid();

	return {
		ruleId: str(b.ruleId, RULE_ID_PATTERN),
		state: state as RealtimeFindingState,
		organisationId: str(b.organisationId, ID_PATTERN),
		projectId: str(b.projectId, ID_PATTERN),
		environment: str(b.environment, ENVIRONMENT_PATTERN),
		group: stringMap(b.group),
		metric: optionalShortString(b.metric),
		operator: optionalShortString(b.operator),
		value: finiteNumber(b.value) as number,
		threshold: finiteNumber(b.threshold) as number,
		windowSec: finiteNumber(b.windowSec, { optional: true }),
		sampleCount: Math.max(0, Math.floor(finiteNumber(b.sampleCount, { optional: true }) ?? 0)),
		dedupeKey: str(b.dedupeKey, DEDUPE_PATTERN),
		observedAt,
		sample: stringMap(b.sample),
	};
}

export function toRealtimeFindingView(row: RealtimeFinding): RealtimeFindingView {
	const parse = (raw: string) => {
		try {
			const value = JSON.parse(raw);
			return value && typeof value === "object" && !Array.isArray(value)
				? (value as Record<string, string>)
				: {};
		} catch {
			return {};
		}
	};
	return {
		id: row.id,
		organisationId: row.organisationId,
		projectId: row.projectId,
		environment: row.environment,
		ruleId: row.ruleId,
		ruleName: row.ruleName,
		kind: row.kind,
		mode: row.mode,
		severity: row.severity,
		state: row.state,
		metric: row.metric,
		operator: row.operator,
		value: row.value,
		threshold: row.threshold,
		windowSec: row.windowSec,
		sampleCount: row.sampleCount,
		group: parse(row.group),
		sample: parse(row.sample),
		occurrences: row.occurrences,
		firstSeenAt: row.firstSeenAt.toISOString(),
		lastSeenAt: row.lastSeenAt.toISOString(),
		resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
	};
}

async function assertTenant(input: RealtimeFindingInput) {
	const messages = getMessage();
	const project = await prisma.project.findUnique({
		where: { id: input.projectId },
		select: { organisationId: true },
	});
	if (!project || project.organisationId !== input.organisationId) {
		throw new RealtimeFindingError(messages.REALTIME_FINDING_TENANT_UNKNOWN, 404);
	}
	const environment = await prisma.projectEnvironment.findUnique({
		where: { projectId_name: { projectId: input.projectId, name: input.environment } },
		select: { id: true },
	});
	if (!environment) {
		throw new RealtimeFindingError(messages.REALTIME_FINDING_TENANT_UNKNOWN, 404);
	}
}

/**
 * Record an engine finding. The rule must be active and its scope must cover
 * the finding's tenant; rule metadata comes from the server-side definition,
 * never from the payload.
 */
export async function recordRealtimeFinding(
	input: RealtimeFindingInput
): Promise<{ transition: RealtimeFindingTransition; finding: RealtimeFindingView | null }> {
	const messages = getMessage();
	const rule = await findActiveRealtimeRule(input.ruleId);
	if (!rule || !isWithinRuleScope(rule, input)) {
		throw new RealtimeFindingError(messages.REALTIME_FINDING_RULE_UNKNOWN, 404);
	}
	await assertTenant(input);

	const existing = await prisma.realtimeFinding.findUnique({
		where: { dedupeKey: input.dedupeKey },
	});
	if (
		existing &&
		(existing.organisationId !== input.organisationId ||
			existing.projectId !== input.projectId ||
			existing.environment !== input.environment ||
			existing.ruleId !== input.ruleId)
	) {
		throw new RealtimeFindingError(messages.REALTIME_FINDING_TENANT_CONFLICT, 409);
	}

	const measurement = {
		ruleName: rule.name,
		kind: rule.kind,
		mode: rule.mode,
		severity: rule.severity,
		metric: input.metric ?? null,
		operator: input.operator ?? null,
		value: input.value,
		threshold: input.threshold,
		windowSec: input.windowSec ?? null,
		sampleCount: input.sampleCount,
		group: JSON.stringify(input.group),
		sample: JSON.stringify(input.sample),
	};

	let row: RealtimeFinding;
	let transition: RealtimeFindingTransition;
	if (input.state === "resolved") {
		if (!existing || existing.state === "resolved") {
			return { transition: "ignored", finding: existing ? toRealtimeFindingView(existing) : null };
		}
		// Keep the breach measurement; the resolving window is often empty.
		row = await prisma.realtimeFinding.update({
			where: { id: existing.id },
			data: {
				state: "resolved",
				resolvedAt: input.observedAt,
			},
		});
		transition = "resolved";
	} else if (!existing) {
		row = await prisma.realtimeFinding.create({
			data: {
				...measurement,
				organisationId: input.organisationId,
				projectId: input.projectId,
				environment: input.environment,
				ruleId: input.ruleId,
				dedupeKey: input.dedupeKey,
				state: "firing",
				firstSeenAt: input.observedAt,
				lastSeenAt: input.observedAt,
			},
		});
		transition = "opened";
	} else {
		const reopened = existing.state === "resolved";
		row = await prisma.realtimeFinding.update({
			where: { id: existing.id },
			data: {
				...measurement,
				state: "firing",
				lastSeenAt: input.observedAt,
				...(reopened ? { resolvedAt: null, occurrences: { increment: 1 } } : {}),
			},
		});
		transition = reopened ? "reopened" : "updated";
	}

	const view = toRealtimeFindingView(row);
	if (transition !== "updated") {
		try {
			await onRealtimeFinding(view, transition);
		} catch (error) {
			console.error("[realtime] finding extension failed", error);
		}
	}
	return { transition, finding: view };
}

/** Findings for the caller's current project, scoped to one environment. */
export async function listRealtimeFindings(options: {
	environment: string;
	state?: string | null;
	limit?: number;
}): Promise<RealtimeFindingView[]> {
	const messages = getMessage();
	const organisation = await getCurrentOrganisation();
	if (!organisation?.id) throw new RealtimeFindingError(messages.NO_ORGANISATION_SELECTED, 400);
	const project = await getCurrentProjectForOrganisation(organisation.id);
	if (!project?.id) throw new RealtimeFindingError(messages.REALTIME_FINDING_NO_PROJECT, 400);
	const environment = String(options.environment || "").trim().toLowerCase();
	if (!ENVIRONMENT_PATTERN.test(environment)) invalid();
	const state =
		options.state && REALTIME_FINDING_STATES.includes(options.state as RealtimeFindingState)
			? options.state
			: undefined;
	const limit = Math.min(Math.max(Math.floor(options.limit || 100), 1), 500);

	const rows = await prisma.realtimeFinding.findMany({
		where: {
			organisationId: organisation.id,
			projectId: project.id,
			environment,
			...(state ? { state } : {}),
		},
		orderBy: [{ state: "asc" }, { lastSeenAt: "desc" }],
		take: limit,
	});
	return rows.map(toRealtimeFindingView);
}
