import type { RealtimeRule as RealtimeRuleRow } from "@prisma/client";
import prisma from "@/lib/prisma";
import getMessage from "@/constants/messages";
import { getCurrentUser } from "@/lib/session";
import {
	getCurrentOrganisation,
	getCurrentProjectForOrganisation,
} from "@/lib/organisation";
import { normalizeProjectEnvironment } from "@/lib/project-environment";
import { isRealtimeAttributeField } from "./attributes";
import {
	REALTIME_RULE_KINDS,
	REALTIME_RULE_MODES,
	REALTIME_SEVERITIES,
	type RealtimeRule,
	type RealtimeRuleCondition,
	type RealtimeRuleKind,
	type RealtimeRuleMode,
	type RealtimeSeverity,
} from "./types";
import {
	REALTIME_RULE_OWNERS,
	engineRuleId,
	parseStoredDefinition,
	resetRealtimeRuleCache,
	type RealtimeRuleDefinition,
	type RealtimeRuleOwner,
} from "./rule-source";
import {
	REALTIME_CONDITION_OPS,
	REALTIME_NUMERIC_CONDITION_OPS,
	REALTIME_NUMERIC_FIELDS,
	REALTIME_RULE_LIMITS,
	REALTIME_RULE_METRICS,
	REALTIME_RULE_OPERATORS,
	REALTIME_STRING_FIELDS,
} from "./rule-fields";


const {
	maxRulesPerProject: MAX_RULES_PER_PROJECT,
	maxName: MAX_NAME,
	maxConditions: MAX_CONDITIONS,
	maxConditionValues: MAX_CONDITION_VALUES,
	maxValueLength: MAX_VALUE_LENGTH,
	maxGroupBy: MAX_GROUP_BY,
	minWindowSec: MIN_WINDOW_SEC,
	maxWindowSec: MAX_WINDOW_SEC,
	minCooldownSec: MIN_COOLDOWN_SEC,
	maxCooldownSec: MAX_COOLDOWN_SEC,
	maxMinSamples: MAX_MIN_SAMPLES,
} = REALTIME_RULE_LIMITS;
const MAX_DESCRIPTION = 500;
const DEFAULT_ENVIRONMENT = "production";
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export {
	REALTIME_RULE_OWNERS,
	engineRuleId,
	resetRealtimeRuleCache,
	type RealtimeRuleDefinition,
	type RealtimeRuleOwner,
};
export { listEngineRealtimeRules, parseEngineRuleId, toEngineRule } from "./rule-source";

export class RealtimeRuleError extends Error {
	constructor(message: string, readonly status = 400) {
		super(message);
		this.name = "RealtimeRuleError";
	}
}

export type RealtimeRuleScopeContext = {
	organisationId: string;
	projectId: string;
	environment: string;
	userId: string;
};


export type RealtimeRuleInput = {
	name: string;
	description: string;
	kind: RealtimeRuleKind;
	mode: RealtimeRuleMode;
	severity: RealtimeSeverity;
	enabled: boolean;
	definition: RealtimeRuleDefinition;
};

export type RealtimeRuleView = RealtimeRuleInput & {
	id: string;
	owner: string;
	engineRuleId: string;
	environment: string;
	createdAt: string;
	updatedAt: string;
};


function invalid(): never {
	throw new RealtimeRuleError(getMessage().REALTIME_RULE_INVALID);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
	if (typeof value !== "string" || !allowed.includes(value as T)) invalid();
	return value as T;
}

function boundedInt(value: unknown, min: number, max: number): number {
	if (typeof value !== "number" || !Number.isInteger(value)) invalid();
	if (value < min || value > max) invalid();
	return value;
}

function isRuleField(field: string): boolean {
	return (
		(REALTIME_STRING_FIELDS as readonly string[]).includes(field) ||
		(REALTIME_NUMERIC_FIELDS as readonly string[]).includes(field) ||
		isRealtimeAttributeField(field)
	);
}

function isGroupField(field: string): boolean {
	return (REALTIME_STRING_FIELDS as readonly string[]).includes(field) || isRealtimeAttributeField(field);
}

function parseConditions(value: unknown): RealtimeRuleCondition[] {
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value) || value.length > MAX_CONDITIONS) invalid();
	return value.map((raw) => {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) invalid();
		const condition = raw as Record<string, unknown>;
		const field = condition.field;
		if (typeof field !== "string" || !isRuleField(field)) invalid();
		let op = oneOf(condition.op, REALTIME_CONDITION_OPS);
		const rawValues = condition.values ?? [];
		if (!Array.isArray(rawValues) || rawValues.length > MAX_CONDITION_VALUES) invalid();
		const values = rawValues.map((item) => {
			if (typeof item !== "string" || item.length > MAX_VALUE_LENGTH) invalid();
			return item.trim();
		});
		if (op !== "exists" && values.filter(Boolean).length === 0) invalid();
		const numeric = (REALTIME_NUMERIC_CONDITION_OPS as readonly string[]).includes(op);
		// Numeric and contains compare against one value; a list would be silently ignored.
		if ((numeric || op === "contains") && values.length > 1) invalid();
		if (numeric && !Number.isFinite(Number(values[0]))) invalid();
		// "= a, b" means "is one of": eq/neq only compare the first value.
		if (values.length > 1 && op === "eq") op = "in";
		if (values.length > 1 && op === "neq") op = "not_in";
		return { field, op, values: op === "exists" ? [] : values };
	});
}

function parseGroupBy(value: unknown): string[] {
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value) || value.length > MAX_GROUP_BY) invalid();
	const out = value.map((field) => {
		if (typeof field !== "string" || !isGroupField(field)) invalid();
		return field;
	});
	return Array.from(new Set(out));
}

/** Strictly parse a create/update body. Scope and owner never come from the body. */
export function parseRealtimeRuleInput(body: unknown): RealtimeRuleInput {
	if (!body || typeof body !== "object" || Array.isArray(body)) invalid();
	const b = body as Record<string, unknown>;
	const name = typeof b.name === "string" ? b.name.trim() : "";
	if (!name || name.length > MAX_NAME) invalid();
	const description = b.description === undefined ? "" : b.description;
	if (typeof description !== "string" || description.length > MAX_DESCRIPTION) invalid();
	const mode = oneOf(b.mode ?? "window", REALTIME_RULE_MODES);
	const raw = (b.definition && typeof b.definition === "object" && !Array.isArray(b.definition)
		? b.definition
		: {}) as Record<string, unknown>;

	const match = parseConditions(raw.match);
	const groupBy = parseGroupBy(raw.groupBy);
	const cooldownSec =
		raw.cooldownSec === undefined
			? 900
			: boundedInt(raw.cooldownSec, MIN_COOLDOWN_SEC, MAX_COOLDOWN_SEC);

	let definition: RealtimeRuleDefinition;
	if (mode === "instant") {
		if (match.length === 0) invalid();
		definition = { match, groupBy, threshold: 0, cooldownSec };
	} else {
		const threshold = raw.threshold;
		if (typeof threshold !== "number" || !Number.isFinite(threshold) || threshold < 0) invalid();
		definition = {
			match,
			groupBy,
			metric: oneOf(raw.metric, REALTIME_RULE_METRICS),
			operator: oneOf(raw.operator, REALTIME_RULE_OPERATORS),
			threshold,
			windowSec: boundedInt(raw.windowSec, MIN_WINDOW_SEC, MAX_WINDOW_SEC),
			minSamples:
				raw.minSamples === undefined ? 1 : boundedInt(raw.minSamples, 1, MAX_MIN_SAMPLES),
			cooldownSec,
		};
	}

	return {
		name,
		description: description.trim(),
		kind: oneOf(b.kind ?? (definition.metric === "cost" ? "cost" : "threshold"), REALTIME_RULE_KINDS),
		mode,
		severity: oneOf(b.severity ?? "warning", REALTIME_SEVERITIES),
		enabled: b.enabled === undefined ? true : b.enabled === true,
		definition,
	};
}


export function toRealtimeRuleView(row: RealtimeRuleRow): RealtimeRuleView {
	const definition = parseStoredDefinition(row.definition) || {
		match: [],
		groupBy: [],
		threshold: 0,
		cooldownSec: 900,
	};
	return {
		id: row.id,
		owner: row.owner,
		engineRuleId: engineRuleId(row),
		name: row.name,
		description: row.description,
		kind: row.kind as RealtimeRuleKind,
		mode: row.mode as RealtimeRuleMode,
		severity: row.severity as RealtimeSeverity,
		enabled: row.enabled,
		environment: row.environment,
		definition,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}


/**
 * Rules are shared by everyone in the project environment, so the scope
 * always comes from the session and the environment must already exist in
 * the current project.
 */
export async function resolveRealtimeRuleScope(
	environmentHeader: string | undefined
): Promise<RealtimeRuleScopeContext> {
	const messages = getMessage();
	const user = await getCurrentUser();
	if (!user) throw new RealtimeRuleError(messages.UNAUTHORIZED_USER, 401);
	const organisation = await getCurrentOrganisation();
	if (!organisation?.id) throw new RealtimeRuleError(messages.NO_ORGANISATION_SELECTED);
	const project = await getCurrentProjectForOrganisation(organisation.id);
	if (!project?.id) throw new RealtimeRuleError(messages.REALTIME_FINDING_NO_PROJECT, 403);

	let environment = DEFAULT_ENVIRONMENT;
	if (environmentHeader) {
		try {
			environment = normalizeProjectEnvironment(environmentHeader);
		} catch {
			invalid();
		}
	}
	const known = await prisma.projectEnvironment.findUnique({
		where: { projectId_name: { projectId: project.id, name: environment } },
		select: { id: true },
	});
	if (!known) throw new RealtimeRuleError(messages.REALTIME_RULE_ENVIRONMENT_UNKNOWN, 404);

	return {
		organisationId: organisation.id,
		projectId: project.id,
		environment,
		userId: user.id,
	};
}

export async function findScopedRule(
	scope: RealtimeRuleScopeContext,
	owner: RealtimeRuleOwner,
	id: string
) {
	if (typeof id !== "string" || !ID_PATTERN.test(id)) {
		throw new RealtimeRuleError(getMessage().REALTIME_RULE_NOT_FOUND, 404);
	}
	const row = await prisma.realtimeRule.findFirst({
		where: {
			id,
			owner,
			organisationId: scope.organisationId,
			projectId: scope.projectId,
			environment: scope.environment,
		},
	});
	if (!row) throw new RealtimeRuleError(getMessage().REALTIME_RULE_NOT_FOUND, 404);
	return row;
}

export async function listRealtimeRules(scope: RealtimeRuleScopeContext, owner: RealtimeRuleOwner) {
	const rows = await prisma.realtimeRule.findMany({
		where: {
			owner,
			organisationId: scope.organisationId,
			projectId: scope.projectId,
			environment: scope.environment,
		},
		orderBy: { createdAt: "desc" },
	});
	return rows.map(toRealtimeRuleView);
}

export async function createRealtimeRule(
	scope: RealtimeRuleScopeContext,
	owner: RealtimeRuleOwner,
	input: RealtimeRuleInput
) {
	const count = await prisma.realtimeRule.count({ where: { projectId: scope.projectId } });
	if (count >= MAX_RULES_PER_PROJECT) {
		throw new RealtimeRuleError(getMessage().REALTIME_RULE_LIMIT, 409);
	}
	const row = await prisma.realtimeRule.create({
		data: {
			organisationId: scope.organisationId,
			projectId: scope.projectId,
			environment: scope.environment,
			owner,
			name: input.name,
			description: input.description,
			kind: input.kind,
			mode: input.mode,
			severity: input.severity,
			enabled: input.enabled,
			definition: JSON.stringify(input.definition),
			createdByUserId: scope.userId,
			updatedByUserId: scope.userId,
		},
	});
	resetRealtimeRuleCache();
	return toRealtimeRuleView(row);
}

export async function updateRealtimeRule(
	scope: RealtimeRuleScopeContext,
	owner: RealtimeRuleOwner,
	id: string,
	input: RealtimeRuleInput
) {
	const existing = await findScopedRule(scope, owner, id);
	const row = await prisma.realtimeRule.update({
		where: { id: existing.id },
		data: {
			name: input.name,
			description: input.description,
			kind: input.kind,
			mode: input.mode,
			severity: input.severity,
			enabled: input.enabled,
			definition: JSON.stringify(input.definition),
			updatedByUserId: scope.userId,
		},
	});
	resetRealtimeRuleCache();
	return toRealtimeRuleView(row);
}

export async function setRealtimeRuleEnabled(
	scope: RealtimeRuleScopeContext,
	owner: RealtimeRuleOwner,
	id: string,
	enabled: boolean
) {
	const existing = await findScopedRule(scope, owner, id);
	const row = await prisma.realtimeRule.update({
		where: { id: existing.id },
		data: { enabled, updatedByUserId: scope.userId },
	});
	resetRealtimeRuleCache();
	return toRealtimeRuleView(row);
}

export async function deleteRealtimeRule(
	scope: RealtimeRuleScopeContext,
	owner: RealtimeRuleOwner,
	id: string
) {
	const existing = await findScopedRule(scope, owner, id);
	await prisma.realtimeRule.delete({ where: { id: existing.id } });
	resetRealtimeRuleCache();
	return { id: existing.id };
}

