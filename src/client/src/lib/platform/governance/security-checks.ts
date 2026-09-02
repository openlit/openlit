import { createHash } from "crypto";
import {
	classifyGenerationHealth,
	matchesGenerationHealthChip,
} from "@/lib/platform/generation-health/classify";
import { fillTemplate } from "@/lib/platform/generation-health/format";
import {
	detectAgentLoops,
	spanLoopAttrs,
	type AgentLoopSpan,
} from "@/lib/platform/agent-loop/classify";
import getMessage from "@/constants/messages";
import type {
	GovernanceFinding,
	GovernanceSeverity,
} from "@/types/governance-report";
import type { TraceHeirarchySpan } from "@/types/trace";
import { CODING_AGENT_ATTR } from "@/lib/platform/coding-agents/table-details";
import {
	classifySpanRole,
	readSpanAttr,
	spanDurationMs,
} from "./hierarchy";

function stableFindingId(parts: string[]): string {
	return createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 12);
}

function worstSeverity(
	findings: GovernanceFinding[]
): GovernanceSeverity | "none" {
	for (const level of ["critical", "major", "minor", "info"] as const) {
		if (findings.some((f) => f.severity === level)) return level;
	}
	return "none";
}

export function buildSecurityFindings(
	spans: TraceHeirarchySpan[]
): GovernanceFinding[] {
	const m = getMessage();
	const findings: GovernanceFinding[] = [];

	for (const span of spans) {
		if (span.StatusCode === "STATUS_CODE_ERROR" || span.StatusCode === "ERROR") {
			findings.push({
				id: stableFindingId(["span_error", span.SpanId]),
				category: "span_error",
				severity: "major",
				summary: m.GOVERNANCE_FINDING_SPAN_ERROR_SUMMARY.replace(
					"{name}",
					span.SpanName || span.SpanId
				),
				detail:
					span.StatusMessage ||
					m.GOVERNANCE_FINDING_SPAN_ERROR_DETAIL,
				span_refs: [span.SpanId],
				evidence: { status_code: span.StatusCode || "" },
			});
		}

		const health = classifyGenerationHealth(span.SpanAttributes || {});
		if (matchesGenerationHealthChip(health, "truncated")) {
			findings.push({
				id: stableFindingId(["truncated", span.SpanId]),
				category: "generation_health",
				severity: "minor",
				summary: m.GENERATION_HEALTH_CHIP_TRUNCATED,
				detail: m.GENERATION_HEALTH_DETAIL_TRUNCATED,
				span_refs: [span.SpanId],
			});
		}
		if (matchesGenerationHealthChip(health, "filtered")) {
			findings.push({
				id: stableFindingId(["filtered", span.SpanId]),
				category: "generation_health",
				severity: "minor",
				summary: m.GENERATION_HEALTH_CHIP_FILTERED,
				detail: m.GENERATION_HEALTH_DETAIL_FILTERED,
				span_refs: [span.SpanId],
			});
		}
		if (matchesGenerationHealthChip(health, "empty")) {
			findings.push({
				id: stableFindingId(["empty", span.SpanId]),
				category: "generation_health",
				severity: "major",
				summary: m.GENERATION_HEALTH_CHIP_EMPTY,
				detail: m.GENERATION_HEALTH_DETAIL_EMPTY,
				span_refs: [span.SpanId],
			});
		}
		if (health.modelSwap) {
			findings.push({
				id: stableFindingId(["swapped", span.SpanId]),
				category: "generation_health",
				severity: "major",
				summary: m.GENERATION_HEALTH_CHIP_SWAPPED,
				detail: fillTemplate(m.GENERATION_HEALTH_DETAIL_SWAPPED, {
					requested: health.requestedModel,
					served: health.servedModel,
				}),
				span_refs: [span.SpanId],
			});
		}

		const classification = readSpanAttr(span, [
			CODING_AGENT_ATTR.userClassification,
		]);
		if (classification === "disputed") {
			findings.push({
				id: stableFindingId(["classification_disputed", span.SpanId]),
				category: "coding_agent",
				severity: "major",
				summary: m.GOVERNANCE_FINDING_CLASSIFICATION_DISPUTED_SUMMARY,
				detail: m.GOVERNANCE_FINDING_CLASSIFICATION_DISPUTED_DETAIL,
				span_refs: [span.SpanId],
			});
		} else if (classification === "personal") {
			findings.push({
				id: stableFindingId(["classification_personal", span.SpanId]),
				category: "coding_agent",
				severity: "info",
				summary: m.GOVERNANCE_FINDING_CLASSIFICATION_PERSONAL_SUMMARY,
				detail: m.GOVERNANCE_FINDING_CLASSIFICATION_PERSONAL_DETAIL,
				span_refs: [span.SpanId],
			});
		}

		const permissionMode = readSpanAttr(span, [
			CODING_AGENT_ATTR.policyPermissionMode,
		]);
		if (
			permissionMode &&
			!["default", "plan", "acceptEdits"].includes(permissionMode)
		) {
			findings.push({
				id: stableFindingId(["permission_mode", span.SpanId, permissionMode]),
				category: "policy",
				severity: "info",
				summary: m.GOVERNANCE_FINDING_PERMISSION_MODE_SUMMARY.replace(
					"{mode}",
					permissionMode
				),
				detail: m.GOVERNANCE_FINDING_PERMISSION_MODE_DETAIL,
				span_refs: [span.SpanId],
				evidence: { permission_mode: permissionMode },
			});
		}
	}

	const loopSpans: AgentLoopSpan[] = spans.map((span) => ({
		traceId: span.TraceId,
		SpanAttributes: span.SpanAttributes,
		ResourceAttributes: span.ResourceAttributes,
		Timestamp: span.Timestamp,
	}));
	const loops = detectAgentLoops(loopSpans);
	for (const loop of loops) {
		const spanIds = loop.traceIds.filter(Boolean);
		if (!spanIds.length) continue;
		findings.push({
			id: stableFindingId(["agent_loop", loop.toolName, loop.fingerprint]),
			category: "agent_loop",
			severity: loop.count >= 8 ? "critical" : loop.count >= 5 ? "major" : "minor",
			summary: m.GOVERNANCE_FINDING_AGENT_LOOP_SUMMARY
				.replace("{tool}", loop.toolName)
				.replace("{count}", String(loop.count)),
			detail: m.GOVERNANCE_FINDING_AGENT_LOOP_DETAIL
				.replace("{wasted_tokens}", String(loop.wastedTokens))
				.replace("{wasted_cost}", loop.wastedCost.toFixed(4)),
			span_refs: spanIds.slice(0, 12),
			evidence: {
				tool_name: loop.toolName,
				count: loop.count,
				wasted_tokens: loop.wastedTokens,
				wasted_cost: loop.wastedCost,
			},
		});
	}

	// Harness heuristics
	const toolCount = spans.filter((s) => classifySpanRole(s) === "tool").length;
	if (toolCount >= 25) {
		findings.push({
			id: stableFindingId(["harness_tool_burst"]),
			category: "harness",
			severity: "minor",
			summary: m.GOVERNANCE_FINDING_TOOL_BURST_SUMMARY.replace(
				"{count}",
				String(toolCount)
			),
			detail: m.GOVERNANCE_FINDING_TOOL_BURST_DETAIL,
			span_refs: spans
				.filter((s) => classifySpanRole(s) === "tool")
				.map((s) => s.SpanId)
				.slice(0, 8),
		});
	}

	const deepSpans = spans.filter((s) => (s.children || []).length >= 8);
	if (deepSpans.length) {
		findings.push({
			id: stableFindingId(["harness_wide_branch"]),
			category: "harness",
			severity: "info",
			summary: m.GOVERNANCE_FINDING_WIDE_BRANCH_SUMMARY,
			detail: m.GOVERNANCE_FINDING_WIDE_BRANCH_DETAIL,
			span_refs: deepSpans.map((s) => s.SpanId).slice(0, 6),
		});
	}

	return findings;
}

export function buildHarnessMetrics(
	root: TraceHeirarchySpan,
	spans: TraceHeirarchySpan[]
): import("@/types/governance-report").GovernanceHarnessReport {
	const models = new Set<string>();
	const tools = new Set<string>();
	let llmCallCount = 0;
	let toolCallCount = 0;
	let retrievalCallCount = 0;
	let embeddingCallCount = 0;
	let databaseCallCount = 0;
	let httpCallCount = 0;
	let errorCount = 0;
	let totalCostUsd = 0;
	let totalDurationMs = 0;

	for (const span of spans) {
		const role = classifySpanRole(span);
		if (role === "llm") llmCallCount++;
		if (role === "tool") toolCallCount++;
		if (role === "retrieval") retrievalCallCount++;
		if (role === "embedding") embeddingCallCount++;
		if (role === "database") databaseCallCount++;
		if (role === "http") httpCallCount++;
		if (
			span.StatusCode === "STATUS_CODE_ERROR" ||
			span.StatusCode === "ERROR"
		) {
			errorCount++;
		}
		totalDurationMs += spanDurationMs(span);
		const model = readSpanAttr(span, [
			"gen_ai.request.model",
			"gen_ai.response.model",
		]);
		if (model) models.add(model);
		const tool = readSpanAttr(span, [
			"gen_ai.tool.name",
			"gen_ai.tool.call.name",
			"coding_agent.tool.name",
		]);
		if (tool) tools.add(tool);
		const cost = Number(span.Cost);
		if (Number.isFinite(cost) && cost > 0) totalCostUsd += cost;
	}

	const loopSpans: AgentLoopSpan[] = spans.map((span) => ({
		traceId: span.TraceId,
		SpanAttributes: span.SpanAttributes,
		ResourceAttributes: span.ResourceAttributes,
	}));
	const loops = detectAgentLoops(loopSpans);
	const topLoop = loops[0];

	return {
		span_count: spans.length,
		max_depth: maxHierarchyDepth(root),
		llm_call_count: llmCallCount,
		tool_call_count: toolCallCount,
		retrieval_call_count: retrievalCallCount,
		embedding_call_count: embeddingCallCount,
		database_call_count: databaseCallCount,
		http_call_count: httpCallCount,
		error_count: errorCount,
		total_cost_usd: totalCostUsd,
		total_duration_ms: totalDurationMs,
		models_used: Array.from(models).sort(),
		tools_used: Array.from(tools).sort(),
		permission_mode: readSpanAttr(root, [CODING_AGENT_ATTR.policyPermissionMode]),
		content_capture_mode: readSpanAttr(root, [
			CODING_AGENT_ATTR.contentCaptureMode,
		]),
		user_classification: readSpanAttr(root, [
			CODING_AGENT_ATTR.userClassification,
		]),
		agent_loop: topLoop
			? {
					tool_name: topLoop.toolName,
					count: topLoop.count,
					wasted_tokens: topLoop.wastedTokens,
					wasted_cost: topLoop.wastedCost,
				}
			: undefined,
	};
}

function maxHierarchyDepth(span: TraceHeirarchySpan, depth = 1): number {
	const children = span.children || [];
	if (!children.length) return depth;
	return Math.max(...children.map((child) => maxHierarchyDepth(child, depth + 1)));
}

export function summarizeGovernanceReport(
	findings: GovernanceFinding[],
	ruleMatchCount: number,
	evaluationCount: number
): { risk_level: GovernanceSeverity | "none"; summary: string } {
	const risk_level = worstSeverity(findings);
	const m = getMessage();
	if (risk_level === "none" && ruleMatchCount === 0 && evaluationCount === 0) {
		return {
			risk_level: "none",
			summary: m.GOVERNANCE_SUMMARY_CLEAN,
		};
	}
	const parts: string[] = [];
	if (findings.length) {
		parts.push(
			m.GOVERNANCE_SUMMARY_FINDINGS.replace("{count}", String(findings.length))
		);
	}
	if (ruleMatchCount) {
		parts.push(
			m.GOVERNANCE_SUMMARY_RULES.replace("{count}", String(ruleMatchCount))
		);
	}
	if (evaluationCount) {
		parts.push(
			m.GOVERNANCE_SUMMARY_EVALS.replace("{count}", String(evaluationCount))
		);
	}
	return {
		risk_level,
		summary: parts.join(" · ") || m.GOVERNANCE_SUMMARY_MIXED,
	};
}

export { worstSeverity };
