import { createHash } from "crypto";
import {
	classifyGenerationHealth,
	matchesGenerationHealthChip,
} from "@/lib/platform/generation-health/classify";
import { fillTemplate } from "@/lib/platform/generation-health/format";
import {
	detectAgentLoops,
	spanCostOf,
	spanTokensOf,
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
import { extractResourceHint, matchingLoopSpans } from "./evidence";

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

function uniqueSpanIds(ids: string[], limit = 12): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const id of ids) {
		const trimmed = String(id || "").trim();
		if (!trimmed || seen.has(trimmed)) continue;
		seen.add(trimmed);
		out.push(trimmed);
		if (out.length >= limit) break;
	}
	return out;
}

export function buildSecurityFindings(
	spans: TraceHeirarchySpan[]
): GovernanceFinding[] {
	const m = getMessage();
	const findings: GovernanceFinding[] = [];
	const permissionModes = new Map<
		string,
		{ spanIds: string[]; resource?: string }
	>();
	const classifications = new Map<
		string,
		{ spanIds: string[]; kind: "disputed" | "personal" }
	>();

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
				remediation: m.GOVERNANCE_REMEDIATION_SPAN_ERROR,
				resource: extractResourceHint(span) || undefined,
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
				remediation: m.GOVERNANCE_REMEDIATION_GENERATION_HEALTH,
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
				remediation: m.GOVERNANCE_REMEDIATION_GENERATION_HEALTH,
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
				remediation: m.GOVERNANCE_REMEDIATION_GENERATION_HEALTH,
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
				remediation: m.GOVERNANCE_REMEDIATION_MODEL_SWAP,
				span_refs: [span.SpanId],
				evidence: {
					requested_model: health.requestedModel || "",
					served_model: health.servedModel || "",
				},
			});
		}

		const classification = readSpanAttr(span, [
			CODING_AGENT_ATTR.userClassification,
		]);
		if (classification === "disputed" || classification === "personal") {
			const entry = classifications.get(classification) || {
				spanIds: [],
				kind: classification,
			};
			entry.spanIds.push(span.SpanId);
			classifications.set(classification, entry);
		}

		const permissionMode = readSpanAttr(span, [
			CODING_AGENT_ATTR.policyPermissionMode,
		]);
		if (
			permissionMode &&
			!["default", "plan", "acceptEdits"].includes(permissionMode)
		) {
			const entry = permissionModes.get(permissionMode) || {
				spanIds: [],
				resource: extractResourceHint(span) || undefined,
			};
			entry.spanIds.push(span.SpanId);
			if (!entry.resource) {
				entry.resource = extractResourceHint(span) || undefined;
			}
			permissionModes.set(permissionMode, entry);
		}
	}

	for (const [mode, entry] of Array.from(permissionModes.entries())) {
		findings.push({
			id: stableFindingId(["permission_mode", mode]),
			category: "policy",
			severity: "info",
			summary: m.GOVERNANCE_FINDING_PERMISSION_MODE_SUMMARY.replace(
				"{mode}",
				mode
			),
			detail: m.GOVERNANCE_FINDING_PERMISSION_MODE_DETAIL,
			remediation: m.GOVERNANCE_REMEDIATION_PERMISSION_MODE,
			resource: entry.resource,
			span_refs: uniqueSpanIds(entry.spanIds),
			evidence: {
				permission_mode: mode,
				span_count: entry.spanIds.length,
			},
		});
	}

	for (const [kind, entry] of Array.from(classifications.entries())) {
		if (kind === "disputed") {
			findings.push({
				id: stableFindingId(["classification_disputed"]),
				category: "coding_agent",
				severity: "major",
				summary: m.GOVERNANCE_FINDING_CLASSIFICATION_DISPUTED_SUMMARY,
				detail: m.GOVERNANCE_FINDING_CLASSIFICATION_DISPUTED_DETAIL,
				remediation: m.GOVERNANCE_REMEDIATION_CLASSIFICATION,
				span_refs: uniqueSpanIds(entry.spanIds),
			});
		} else {
			findings.push({
				id: stableFindingId(["classification_personal"]),
				category: "coding_agent",
				severity: "info",
				summary: m.GOVERNANCE_FINDING_CLASSIFICATION_PERSONAL_SUMMARY,
				detail: m.GOVERNANCE_FINDING_CLASSIFICATION_PERSONAL_DETAIL,
				remediation: m.GOVERNANCE_REMEDIATION_CLASSIFICATION,
				span_refs: uniqueSpanIds(entry.spanIds),
			});
		}
	}

	const loopSpans: AgentLoopSpan[] = spans.map((span) => ({
		traceId: span.TraceId,
		SpanId: span.SpanId,
		SpanAttributes: span.SpanAttributes,
		ResourceAttributes: span.ResourceAttributes,
		Timestamp: span.Timestamp,
	}));
	const loops = detectAgentLoops(loopSpans);
	for (const loop of loops) {
		const matched = matchingLoopSpans(spans, loop.toolName, loop.fingerprint);
		const spanIds = uniqueSpanIds(matched.map((s) => s.SpanId));
		if (!spanIds.length) continue;
		const sample = matched[0];
		const resource =
			(sample && extractResourceHint(sample)) ||
			extractResourceHint({
				SpanAttributes: {
					"gen_ai.tool.args": loop.fingerprint,
					"gen_ai.tool.name": loop.toolName,
				},
			}) ||
			undefined;
		const ordered = matched
			.slice()
			.sort(
				(a, b) =>
					new Date(String(a.Timestamp || 0)).getTime() -
					new Date(String(b.Timestamp || 0)).getTime()
			);
		const wastedDurationMs = ordered
			.slice(1)
			.reduce((sum, span) => sum + spanDurationMs(span), 0);
		const usageReported = loop.wastedTokens > 0 || loop.wastedCost > 0;
		const evidence: Record<string, string | number | boolean> = {
			tool_name: loop.toolName,
			count: loop.count,
			args_fingerprint: loop.fingerprint.slice(0, 180),
			usage_reported: usageReported,
		};
		if (usageReported) {
			evidence.wasted_tokens = loop.wastedTokens;
			evidence.wasted_cost = loop.wastedCost;
		}
		if (wastedDurationMs > 0) {
			evidence.wasted_duration_ms = Math.round(wastedDurationMs);
		}
		const detail = usageReported
			? m.GOVERNANCE_FINDING_AGENT_LOOP_DETAIL.replace(
					"{wasted_tokens}",
					String(loop.wastedTokens)
				).replace("{wasted_cost}", loop.wastedCost.toFixed(4))
			: m.GOVERNANCE_FINDING_AGENT_LOOP_DETAIL_NO_USAGE.replace(
					"{count}",
					String(loop.count)
				).replace(
					"{duration_suffix}",
					wastedDurationMs > 0
						? m.GOVERNANCE_FINDING_AGENT_LOOP_DURATION_SUFFIX.replace(
								"{duration}",
								`${Math.round(wastedDurationMs)}ms`
							)
						: ""
				);
		findings.push({
			id: stableFindingId(["agent_loop", loop.toolName, loop.fingerprint]),
			category: "agent_loop",
			severity: loop.count >= 8 ? "critical" : loop.count >= 5 ? "major" : "minor",
			summary: m.GOVERNANCE_FINDING_AGENT_LOOP_SUMMARY
				.replace("{tool}", loop.toolName)
				.replace("{count}", String(loop.count)),
			detail,
			remediation: m.GOVERNANCE_REMEDIATION_AGENT_LOOP,
			resource,
			span_refs: spanIds,
			evidence,
		});
	}

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
			remediation: m.GOVERNANCE_REMEDIATION_TOOL_BURST,
			span_refs: uniqueSpanIds(
				spans
					.filter((s) => classifySpanRole(s) === "tool")
					.map((s) => s.SpanId)
			),
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
			remediation: m.GOVERNANCE_REMEDIATION_WIDE_BRANCH,
			span_refs: uniqueSpanIds(deepSpans.map((s) => s.SpanId)),
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
	let summedCostUsd = 0;
	let summedTokens = 0;
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

		const attrs = {
			...(span.ResourceAttributes || {}),
			...(span.SpanAttributes || {}),
		};
		const attrCost = spanCostOf(attrs);
		const rowCost = Number(span.Cost);
		const cost =
			Number.isFinite(rowCost) && rowCost > 0
				? rowCost
				: attrCost > 0
					? attrCost
					: 0;
		if (cost > 0) summedCostUsd += cost;
		summedTokens += spanTokensOf(attrs);
	}

	// Coding-agent session roots carry authoritative rollups (tokens always
	// for Cursor; USD only when the vendor sends it). Prefer the greater of
	// the session rollup vs summed child attrs so we do not under-count.
	const sessionCost = Number(
		readSpanAttr(root, [CODING_AGENT_ATTR.sessionCostUsd, "gen_ai.usage.cost"]) ||
			0
	);
	const sessionTokens = Number(
		readSpanAttr(root, [
			"gen_ai.usage.total_tokens",
		]) || 0
	);
	const sessionInput = Number(
		readSpanAttr(root, ["gen_ai.usage.input_tokens"]) || 0
	);
	const sessionOutput = Number(
		readSpanAttr(root, ["gen_ai.usage.output_tokens"]) || 0
	);
	const sessionTokenTotal =
		sessionTokens > 0 ? sessionTokens : sessionInput + sessionOutput;
	const totalCostUsd = Math.max(
		summedCostUsd,
		Number.isFinite(sessionCost) ? sessionCost : 0
	);
	const totalTokens = Math.max(summedTokens, sessionTokenTotal);

	const loopSpans: AgentLoopSpan[] = spans.map((span) => ({
		traceId: span.TraceId,
		SpanAttributes: span.SpanAttributes,
		ResourceAttributes: span.ResourceAttributes,
		Timestamp: span.Timestamp,
	}));
	const loops = detectAgentLoops(loopSpans);
	const topLoop = loops[0];
	let topLoopDurationMs = 0;
	if (topLoop) {
		const matched = matchingLoopSpans(
			spans,
			topLoop.toolName,
			topLoop.fingerprint
		);
		const ordered = matched
			.slice()
			.sort(
				(a, b) =>
					new Date(String(a.Timestamp || 0)).getTime() -
					new Date(String(b.Timestamp || 0)).getTime()
			);
		topLoopDurationMs = ordered
			.slice(1)
			.reduce((sum, span) => sum + spanDurationMs(span), 0);
	}

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
		cost_reported: totalCostUsd > 0,
		total_tokens: totalTokens,
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
					wasted_duration_ms: topLoopDurationMs
						? Math.round(topLoopDurationMs)
						: undefined,
					usage_reported:
						topLoop.wastedTokens > 0 || topLoop.wastedCost > 0,
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
