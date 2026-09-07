import { createHash } from "crypto";
import {
	CODING_AGENT_ATTR,
	CODING_AGENT_SPAN_GIT_COMMIT,
	CODING_AGENT_SPAN_GIT_PR,
	CODING_AGENT_SPAN_SESSION,
	CODING_AGENT_SPAN_SUBAGENT,
} from "@/lib/platform/coding-agents/table-details";
import getMessage from "@/constants/messages";
import type {
	GovernanceFinding,
	GovernanceSeverity,
} from "@/types/governance-report";
import type { TraceHeirarchySpan } from "@/types/trace";
import { readSpanAttr } from "./hierarchy";
import { scanSpanPayloads } from "./secret-scan";

export const GOVERNANCE_EDIT_REJECT_MIN_DECISIONS = 4;
export const GOVERNANCE_EDIT_REJECT_RATIO = 0.5;
export const GOVERNANCE_COMMIT_BLAST = 3;
export const GOVERNANCE_PR_BLAST = 2;
export const GOVERNANCE_SUBAGENT_FANOUT = 4;

const BROAD_MCP_SCOPES = new Set(["user", "local"]);
const RISKY_MCP_SOURCES = new Set(["marketplace"]);
const WRITE_EDIT_DECISIONS = new Set(["accept", "auto_accepted"]);
const FLAGGED_OUTCOMES = new Set(["abandoned_with_change", "cancelled"]);

function stableFindingId(parts: string[]): string {
	return createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 12);
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

function readNumericAttr(span: TraceHeirarchySpan, keys: string[]): number {
	const raw = readSpanAttr(span, keys);
	const numeric = Number(raw);
	return Number.isFinite(numeric) ? numeric : 0;
}

function isTruthyAttr(span: TraceHeirarchySpan, keys: string[]): boolean {
	const raw = readSpanAttr(span, keys).toLowerCase();
	return raw === "true" || raw === "1" || raw === "yes";
}

function maxNumeric(
	spans: TraceHeirarchySpan[],
	keys: string[],
	fallbackCount: number
): { value: number; spanIds: string[] } {
	let value = fallbackCount;
	const spanIds: string[] = [];
	for (const span of spans) {
		const n = readNumericAttr(span, keys);
		if (n > 0) spanIds.push(span.SpanId);
		if (n > value) value = n;
	}
	return { value, spanIds };
}

export function buildCodingAgentFindings(
	spans: TraceHeirarchySpan[]
): GovernanceFinding[] {
	const m = getMessage();
	const findings: GovernanceFinding[] = [];
	const captureModes = new Map<string, string[]>();
	const outcomes = new Map<string, string[]>();
	const mcpBroad = new Map<string, string[]>();
	const mcpMarketplace = new Map<string, string[]>();
	const secretHits = new Map<string, string[]>();
	const dirtyWriteIds: string[] = [];
	const subagentIds: string[] = [];
	const gitCommitIds: string[] = [];
	const gitPrIds: string[] = [];
	let acceptCount = 0;
	let rejectCount = 0;

	for (const span of spans) {
		const capture = readSpanAttr(span, [CODING_AGENT_ATTR.contentCaptureMode]);
		if (capture === "full" || capture === "minimal") {
			const ids = captureModes.get(capture) || [];
			ids.push(span.SpanId);
			captureModes.set(capture, ids);
		}

		const outcome = readSpanAttr(span, [CODING_AGENT_ATTR.sessionOutcome]);
		if (FLAGGED_OUTCOMES.has(outcome)) {
			const ids = outcomes.get(outcome) || [];
			ids.push(span.SpanId);
			outcomes.set(outcome, ids);
		}

		const mcpScope = readSpanAttr(span, [CODING_AGENT_ATTR.mcpScope]);
		const mcpSource = readSpanAttr(span, [CODING_AGENT_ATTR.mcpSource]);
		const mcpServer =
			readSpanAttr(span, [CODING_AGENT_ATTR.mcpServerName]) || "unknown";
		if (BROAD_MCP_SCOPES.has(mcpScope)) {
			const ids = mcpBroad.get(mcpServer) || [];
			ids.push(span.SpanId);
			mcpBroad.set(mcpServer, ids);
		}
		if (RISKY_MCP_SOURCES.has(mcpSource)) {
			const ids = mcpMarketplace.get(mcpServer) || [];
			ids.push(span.SpanId);
			mcpMarketplace.set(mcpServer, ids);
		}

		const kinds = scanSpanPayloads(span.SpanAttributes);
		for (const kind of kinds) {
			const ids = secretHits.get(kind) || [];
			ids.push(span.SpanId);
			secretHits.set(kind, ids);
		}

		const decision = readSpanAttr(span, [CODING_AGENT_ATTR.editDecision]);
		if (decision === "reject") rejectCount += 1;
		if (WRITE_EDIT_DECISIONS.has(decision)) acceptCount += 1;

		const madeWrites =
			readNumericAttr(span, [CODING_AGENT_ATTR.sessionLinesAdded]) > 0 ||
			readNumericAttr(span, [CODING_AGENT_ATTR.sessionCommitCount]) > 0 ||
			WRITE_EDIT_DECISIONS.has(decision);
		if (isTruthyAttr(span, [CODING_AGENT_ATTR.vcsDirty]) && madeWrites) {
			dirtyWriteIds.push(span.SpanId);
		}

		const isSubagentRoot =
			span.SpanName === CODING_AGENT_SPAN_SUBAGENT ||
			(span.SpanName === CODING_AGENT_SPAN_SESSION &&
				(isTruthyAttr(span, [CODING_AGENT_ATTR.sessionIsSubagent]) ||
					readSpanAttr(span, ["coding_agent.agent.type"]) ===
						"subagent" ||
					Boolean(readSpanAttr(span, [CODING_AGENT_ATTR.agentParentId]))));
		if (isSubagentRoot) subagentIds.push(span.SpanId);

		if (span.SpanName === CODING_AGENT_SPAN_GIT_COMMIT) {
			gitCommitIds.push(span.SpanId);
		}
		if (span.SpanName === CODING_AGENT_SPAN_GIT_PR) {
			gitPrIds.push(span.SpanId);
		}
	}

	for (const [mode, spanIds] of Array.from(captureModes.entries())) {
		const full = mode === "full";
		findings.push({
			id: stableFindingId(["content_capture", mode]),
			category: "policy",
			severity: full ? "major" : "info",
			summary: full
				? m.GOVERNANCE_FINDING_CAPTURE_FULL_SUMMARY
				: m.GOVERNANCE_FINDING_CAPTURE_MINIMAL_SUMMARY,
			detail: full
				? m.GOVERNANCE_FINDING_CAPTURE_FULL_DETAIL
				: m.GOVERNANCE_FINDING_CAPTURE_MINIMAL_DETAIL,
			remediation: m.GOVERNANCE_REMEDIATION_CONTENT_CAPTURE,
			span_refs: uniqueSpanIds(spanIds),
			evidence: { content_capture_mode: mode, span_count: spanIds.length },
		});
	}

	for (const [outcome, spanIds] of Array.from(outcomes.entries())) {
		const abandoned = outcome === "abandoned_with_change";
		findings.push({
			id: stableFindingId(["session_outcome", outcome]),
			category: "coding_agent",
			severity: abandoned ? "major" : "info",
			summary: abandoned
				? m.GOVERNANCE_FINDING_OUTCOME_ABANDONED_SUMMARY
				: m.GOVERNANCE_FINDING_OUTCOME_CANCELLED_SUMMARY,
			detail: abandoned
				? m.GOVERNANCE_FINDING_OUTCOME_ABANDONED_DETAIL
				: m.GOVERNANCE_FINDING_OUTCOME_CANCELLED_DETAIL,
			remediation: m.GOVERNANCE_REMEDIATION_SESSION_OUTCOME,
			span_refs: uniqueSpanIds(spanIds),
			evidence: { session_outcome: outcome },
		});
	}

	const sessionReject = maxNumeric(
		spans,
		[CODING_AGENT_ATTR.sessionEditRejectCount],
		rejectCount
	);
	const sessionAccept = maxNumeric(
		spans,
		[CODING_AGENT_ATTR.sessionEditAcceptCount],
		acceptCount
	);
	const totalEdits = sessionAccept.value + sessionReject.value;
	if (
		totalEdits >= GOVERNANCE_EDIT_REJECT_MIN_DECISIONS &&
		sessionReject.value / totalEdits >= GOVERNANCE_EDIT_REJECT_RATIO
	) {
		const percent = Math.round((sessionReject.value / totalEdits) * 100);
		findings.push({
			id: stableFindingId(["edit_reject"]),
			category: "coding_agent",
			severity: percent >= 80 ? "major" : "minor",
			summary: m.GOVERNANCE_FINDING_EDIT_REJECT_SUMMARY.replace(
				"{percent}",
				String(percent)
			),
			detail: m.GOVERNANCE_FINDING_EDIT_REJECT_DETAIL.replace(
				"{rejected}",
				String(sessionReject.value)
			).replace("{total}", String(totalEdits)),
			remediation: m.GOVERNANCE_REMEDIATION_EDIT_REJECT,
			span_refs: uniqueSpanIds([
				...sessionReject.spanIds,
				...sessionAccept.spanIds,
			]),
			evidence: {
				edit_reject_count: sessionReject.value,
				edit_accept_count: sessionAccept.value,
			},
		});
	}

	if (dirtyWriteIds.length) {
		findings.push({
			id: stableFindingId(["vcs_dirty_write"]),
			category: "coding_agent",
			severity: "minor",
			summary: m.GOVERNANCE_FINDING_VCS_DIRTY_SUMMARY,
			detail: m.GOVERNANCE_FINDING_VCS_DIRTY_DETAIL,
			remediation: m.GOVERNANCE_REMEDIATION_VCS_DIRTY,
			span_refs: uniqueSpanIds(dirtyWriteIds),
			evidence: { vcs_dirty: true },
		});
	}

	if (mcpBroad.size) {
		const servers = Array.from(mcpBroad.keys()).sort();
		const spanIds = Array.from(mcpBroad.values()).flat();
		findings.push({
			id: stableFindingId(["mcp_broad", servers.join(",")]),
			category: "policy",
			severity: "info",
			summary: m.GOVERNANCE_FINDING_MCP_SCOPE_SUMMARY.replace(
				"{count}",
				String(servers.length)
			),
			detail: m.GOVERNANCE_FINDING_MCP_SCOPE_DETAIL.replace(
				"{servers}",
				servers.join(", ")
			),
			remediation: m.GOVERNANCE_REMEDIATION_MCP,
			span_refs: uniqueSpanIds(spanIds),
			evidence: {
				mcp_servers: servers.join(", "),
				mcp_scope: "user_or_local",
			},
		});
	}

	if (mcpMarketplace.size) {
		const servers = Array.from(mcpMarketplace.keys()).sort();
		const spanIds = Array.from(mcpMarketplace.values()).flat();
		findings.push({
			id: stableFindingId(["mcp_marketplace", servers.join(",")]),
			category: "policy",
			severity: "minor",
			summary: m.GOVERNANCE_FINDING_MCP_MARKETPLACE_SUMMARY.replace(
				"{count}",
				String(servers.length)
			),
			detail: m.GOVERNANCE_FINDING_MCP_MARKETPLACE_DETAIL.replace(
				"{servers}",
				servers.join(", ")
			),
			remediation: m.GOVERNANCE_REMEDIATION_MCP,
			span_refs: uniqueSpanIds(spanIds),
			evidence: {
				mcp_source: "marketplace",
				mcp_servers: servers.join(", "),
			},
		});
	}

	const commitRollup = maxNumeric(
		spans,
		[CODING_AGENT_ATTR.sessionCommitCount],
		gitCommitIds.length
	);
	const prRollup = maxNumeric(
		spans,
		[CODING_AGENT_ATTR.sessionPrCount],
		gitPrIds.length
	);
	if (
		commitRollup.value >= GOVERNANCE_COMMIT_BLAST ||
		prRollup.value >= GOVERNANCE_PR_BLAST
	) {
		findings.push({
			id: stableFindingId(["git_blast"]),
			category: "coding_agent",
			severity:
				commitRollup.value >= 6 || prRollup.value >= 4 ? "major" : "minor",
			summary: m.GOVERNANCE_FINDING_GIT_BLAST_SUMMARY.replace(
				"{commits}",
				String(commitRollup.value)
			).replace("{prs}", String(prRollup.value)),
			detail: m.GOVERNANCE_FINDING_GIT_BLAST_DETAIL,
			remediation: m.GOVERNANCE_REMEDIATION_GIT_BLAST,
			span_refs: uniqueSpanIds([
				...commitRollup.spanIds,
				...prRollup.spanIds,
				...gitCommitIds,
				...gitPrIds,
			]),
			evidence: {
				commit_count: commitRollup.value,
				pr_count: prRollup.value,
			},
		});
	}

	const subagentRollup = maxNumeric(
		spans,
		[CODING_AGENT_ATTR.sessionSubagentCount],
		subagentIds.length
	);
	if (subagentRollup.value >= GOVERNANCE_SUBAGENT_FANOUT) {
		findings.push({
			id: stableFindingId(["subagent_fanout"]),
			category: "harness",
			severity: subagentRollup.value >= 8 ? "major" : "minor",
			summary: m.GOVERNANCE_FINDING_SUBAGENT_SUMMARY.replace(
				"{count}",
				String(subagentRollup.value)
			),
			detail: m.GOVERNANCE_FINDING_SUBAGENT_DETAIL,
			remediation: m.GOVERNANCE_REMEDIATION_SUBAGENT,
			span_refs: uniqueSpanIds([...subagentRollup.spanIds, ...subagentIds]),
			evidence: { subagent_count: subagentRollup.value },
		});
	}

	if (secretHits.size) {
		const kinds = Array.from(secretHits.keys()).sort();
		const spanIds = Array.from(secretHits.values()).flat();
		const severity: GovernanceSeverity = kinds.includes("private_key")
			? "critical"
			: "major";
		findings.push({
			id: stableFindingId(["secret_payload", kinds.join(",")]),
			category: "policy",
			severity,
			summary: m.GOVERNANCE_FINDING_SECRET_SUMMARY.replace(
				"{kinds}",
				kinds.join(", ")
			),
			detail: m.GOVERNANCE_FINDING_SECRET_DETAIL,
			remediation: m.GOVERNANCE_REMEDIATION_SECRET,
			span_refs: uniqueSpanIds(spanIds),
			evidence: {
				secret_kinds: kinds.join(", "),
				span_count: spanIds.length,
			},
		});
	}

	return findings;
}
