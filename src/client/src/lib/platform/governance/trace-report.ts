import Sanitizer from "@/utils/sanitizer";
import { escapeClickHouseString } from "@/lib/clickhouse-escape";
import { dataCollector } from "../common";
import { evaluateRules } from "../rule-engine/evaluate";
import { OPENLIT_RULES_TABLE_NAME } from "../rule-engine/table-details";
import { OPENLIT_EVALUATION_TABLE_NAME } from "../evaluation/table-details";
import { EVALUATION_SOURCE } from "@/constants/evaluation-sources";
import getMessage from "@/constants/messages";
import { getTraceHierarchy } from "../traces/read";
import type {
	GovernanceEvaluationRow,
	GovernanceRuleEntityType,
	GovernanceRuleMatch,
	TraceGovernanceReport,
} from "@/types/governance-report";
import type { TraceHeirarchySpan } from "@/types/trace";
import {
	flattenHierarchy,
	ruleFieldsFromHierarchySpan,
} from "./hierarchy";
import {
	buildHarnessMetrics,
	buildSecurityFindings,
	summarizeGovernanceReport,
} from "./security-checks";
import { loadOtterSecurityFindings } from "./otter-findings";
import { policyControlsForFindings } from "./policy-packs";
import { stampGovernanceReportId } from "./passport";
import { createHash } from "crypto";

export const GOVERNANCE_MAX_SPANS_RULE_EVAL = 100;
export const GOVERNANCE_MAX_SPAN_IDS_EVAL_QUERY = 200;

const RULE_ENTITY_TYPES: GovernanceRuleEntityType[] = [
	"context",
	"prompt",
	"evaluation",
	"alert",
];

const EVAL_FAIL_VERDICTS = new Set([
	"fail",
	"failed",
	"no",
	"unsafe",
	"toxic",
	"biased",
	"hallucinated",
]);

async function loadRuleNames(
	ruleIds: string[],
	databaseConfigId?: string
): Promise<Map<string, string>> {
	const names = new Map<string, string>();
	if (!ruleIds.length) return names;
	const safeIds = ruleIds
		.map((id) => `'${escapeClickHouseString(Sanitizer.sanitizeValue(id))}'`)
		.join(",");
	const query = `
		SELECT id, name FROM ${OPENLIT_RULES_TABLE_NAME}
		WHERE id IN (${safeIds});
	`;
	const { data, err } = await dataCollector({ query }, "query", databaseConfigId);
	if (err || !data) return names;
	for (const row of data as Array<{ id?: string; name?: string }>) {
		if (row.id) names.set(row.id, row.name || row.id);
	}
	return names;
}

type RuleMatchTemplate = Omit<GovernanceRuleMatch, "span_id" | "matched_fields">;

async function evaluateRulesForFields(
	fields: Record<string, string | number | boolean>,
	databaseConfigId?: string
): Promise<RuleMatchTemplate[]> {
	if (!Object.keys(fields).length) return [];

	const matches: RuleMatchTemplate[] = [];
	const seenRules = new Set<string>();

	for (const entityType of RULE_ENTITY_TYPES) {
		try {
			const result = await evaluateRules(
				{ fields, entity_type: entityType, include_entity_data: false },
				databaseConfigId
			);
			for (const ruleId of result.matchingRuleIds || []) {
				if (seenRules.has(ruleId)) continue;
				seenRules.add(ruleId);
				const entities = (result.entities || [])
					.filter((e) => e.rule_id === ruleId)
					.map((e) => ({
						entity_type: e.entity_type as GovernanceRuleEntityType,
						entity_id: e.entity_id,
					}));
				matches.push({
					rule_id: ruleId,
					entities,
				});
			}
		} catch {
			// Rule evaluation is best-effort for governance surfacing.
		}
	}

	return matches;
}

async function loadEvaluationsForSpans(
	spanIds: string[],
	databaseConfigId?: string
): Promise<GovernanceEvaluationRow[]> {
	if (!spanIds.length) return [];
	const safeIds = spanIds
		.map((id) => `'${escapeClickHouseString(Sanitizer.sanitizeValue(id))}'`)
		.join(",");
	const query = `
		SELECT
			span_id AS span_id,
			arrayMap(
				(e, c, ex, v) ->
				map(
					'evaluation', e,
					'score', if(mapContains(scores, e), toString(scores[e]), ''),
					'classification', c,
					'explanation', ex,
					'verdict', v
				),
				evaluationData.evaluation,
				evaluationData.classification,
				evaluationData.explanation,
				evaluationData.verdict
			) AS evaluations
		FROM ${OPENLIT_EVALUATION_TABLE_NAME}
		WHERE span_id IN (${safeIds})
			AND meta['source'] NOT IN (
				'${EVALUATION_SOURCE.MANUAL_FEEDBACK}',
				'${EVALUATION_SOURCE.AUTO_SKIPPED}'
			)
		ORDER BY created_at DESC
		LIMIT 200;
	`;
	const { data, err } = await dataCollector({ query }, "query", databaseConfigId);
	if (err || !data) return [];

	const rows: GovernanceEvaluationRow[] = [];
	for (const row of data as Array<Record<string, unknown>>) {
		const spanId = String(row.span_id || "");
		const evaluations = (row.evaluations as Array<Record<string, string>>) || [];
		for (const item of evaluations) {
			const evaluationType = String(item.evaluation || "").trim();
			if (!evaluationType) continue;
			const scoreRaw = item.score;
			const score =
				scoreRaw && scoreRaw !== ""
					? Number(scoreRaw)
					: undefined;
			rows.push({
				span_id: spanId,
				evaluation_type: evaluationType,
				score: Number.isFinite(score) ? score : undefined,
				classification: item.classification,
				verdict: item.verdict,
				explanation: item.explanation,
			});
		}
	}
	return rows;
}

function evaluationFindings(
	evaluations: GovernanceEvaluationRow[]
): import("@/types/governance-report").GovernanceFinding[] {
	const findings: import("@/types/governance-report").GovernanceFinding[] = [];
	for (const row of evaluations) {
		const verdict = String(row.verdict || row.classification || "").toLowerCase();
		if (!verdict || !EVAL_FAIL_VERDICTS.has(verdict)) continue;
		findings.push({
			id: createHash("sha1")
				.update(`${row.span_id}:${row.evaluation_type}:${verdict}`)
				.digest("hex")
				.slice(0, 12),
			category: "evaluation",
			severity:
				row.evaluation_type === "toxicity" ||
				row.evaluation_type === "safety"
					? "critical"
					: "major",
			summary: `${row.evaluation_type} flagged on span`,
			detail: row.explanation || `Verdict: ${verdict}`,
			remediation: getMessage().GOVERNANCE_REMEDIATION_EVALUATION,
			span_refs: [row.span_id],
			evidence: {
				evaluation_type: row.evaluation_type,
				verdict,
			},
		});
	}
	return findings;
}

export async function buildTraceGovernanceReport(
	spanId: string,
	opts?: { traceId?: string; environment?: string; databaseConfigId?: string }
): Promise<{ err?: string; report?: TraceGovernanceReport }> {
	const hierarchyResult = await getTraceHierarchy(spanId, {
		traceId: opts?.traceId,
		environment: opts?.environment,
	});
	if (hierarchyResult.err) {
		return { err: String(hierarchyResult.err) };
	}
	const root = hierarchyResult.record as TraceHeirarchySpan;
	if (!root?.SpanId) {
		return { err: "Hierarchy root not found" };
	}

	const spans = flattenHierarchy(root);
	const spanIds = spans.map((s) => s.SpanId).filter(Boolean);
	const spansForRules = spans.slice(0, GOVERNANCE_MAX_SPANS_RULE_EVAL);
	const spanIdsForEval = spanIds.slice(0, GOVERNANCE_MAX_SPAN_IDS_EVAL_QUERY);
	const analysisLimited =
		spans.length > GOVERNANCE_MAX_SPANS_RULE_EVAL ||
		spanIds.length > GOVERNANCE_MAX_SPAN_IDS_EVAL_QUERY;

	// Rule evaluation with field-map deduplication across spans
	const fieldsCache = new Map<string, RuleMatchTemplate[]>();
	const ruleMatches: GovernanceRuleMatch[] = [];

	for (const span of spansForRules) {
		const fields = ruleFieldsFromHierarchySpan(span);
		const cacheKey = createHash("sha1").update(JSON.stringify(fields)).digest("hex");
		let templates = fieldsCache.get(cacheKey);
		if (!templates) {
			templates = await evaluateRulesForFields(fields, opts?.databaseConfigId);
			fieldsCache.set(cacheKey, templates);
		}
		for (const template of templates) {
			ruleMatches.push({
				...template,
				span_id: span.SpanId,
				matched_fields: fields,
			});
		}
	}

	const ruleIds = Array.from(new Set(ruleMatches.map((m) => m.rule_id)));
	const ruleNames = await loadRuleNames(ruleIds, opts?.databaseConfigId);
	for (const match of ruleMatches) {
		match.rule_name = ruleNames.get(match.rule_id) || match.rule_id;
	}

	const evaluations = await loadEvaluationsForSpans(
		spanIdsForEval,
		opts?.databaseConfigId
	);
	const otter = await loadOtterSecurityFindings(
		root.SpanId,
		opts?.databaseConfigId
	);
	const security = [
		...buildSecurityFindings(spans),
		...evaluationFindings(evaluations),
		...otter.findings,
	];
	const harness = buildHarnessMetrics(root, spans);
	const { risk_level, summary } = summarizeGovernanceReport(
		security,
		ruleMatches.length,
		evaluations.length
	);
	const policy_controls = policyControlsForFindings(security);

	return {
		report: stampGovernanceReportId({
			trace_id: root.TraceId || opts?.traceId || spanId,
			root_span_id: root.SpanId,
			risk_level,
			summary,
			harness,
			rules: ruleMatches,
			security,
			evaluations,
			finding_count: security.length,
			rule_match_count: ruleMatches.length,
			analysis_limited: analysisLimited || undefined,
			otter_run_id: otter.otter_run_id,
			policy_controls: policy_controls.length ? policy_controls : undefined,
		}),
	};
}
