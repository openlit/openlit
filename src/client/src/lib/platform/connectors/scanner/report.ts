import { randomUUID } from "crypto";
import type { ScannerFinding, ScannerJob, ScannerReportSummary } from "./types";

const MAX_FINDINGS = 200;
const MAX_TEXT = 2_000;
const MAX_LIST = 16;

const MEDIUM_PLUS = new Set(["medium", "high", "critical", "error"]);

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

function clip(value: unknown): string {
	return String(value ?? "").trim().slice(0, MAX_TEXT);
}

function stringList(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const items = value
		.map((item) => (typeof item === "string" ? clip(item) : clip(asRecord(item)?.name)))
		.filter(Boolean)
		.slice(0, MAX_LIST);
	return items.length ? items : undefined;
}

function countArray(value: unknown): number | undefined {
	return Array.isArray(value) ? value.length : undefined;
}

function findingId(row: Record<string, unknown>, index: number): string {
	return clip(row.id || row.finding_id) || `finding-${index + 1}`;
}

function confidenceText(value: unknown): string | undefined {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value <= 1 ? value.toFixed(2) : String(value);
	}
	return clip(value) || undefined;
}

function normalizeFinding(value: unknown, index: number): ScannerFinding | null {
	const row = asRecord(value);
	if (!row) return null;
	const ruleId = clip(row.rule_id || row.ruleId || row.rule || row.check_id);
	const title = clip(row.title || row.summary || row.message || ruleId);
	if (!ruleId && !title) return null;
	const location = asRecord(row.location) || asRecord(row.region) || {};
	const path = clip(
		row.file_path ||
			row.path ||
			row.file ||
			row.filename ||
			location.path ||
			location.uri ||
			location.file
	);
	const lineRaw =
		row.start_line ?? row.line ?? location.start_line ?? location.line ?? location.startLine;
	const endRaw = row.end_line ?? location.end_line ?? location.endLine;
	const line = typeof lineRaw === "number" ? lineRaw : Number.parseInt(String(lineRaw || ""), 10);
	const endLine = typeof endRaw === "number" ? endRaw : Number.parseInt(String(endRaw || ""), 10);
	return {
		id: findingId(row, index),
		ruleId: ruleId || `UNKNOWN-${index + 1}`,
		severity: clip(row.severity || row.level || "info").toLowerCase() || "info",
		category: clip(row.category || row.detector || row.kind) || undefined,
		scope: clip(row.scope) || undefined,
		toolName: clip(row.tool_name || row.toolName) || undefined,
		path: path || undefined,
		line: Number.isFinite(line) && line > 0 ? line : undefined,
		endLine: Number.isFinite(endLine) && endLine > 0 ? endLine : undefined,
		title: title || ruleId,
		message: clip(row.message || row.explanation || row.description) || undefined,
		helpUrl: clip(row.help_url || row.helpUrl || row.docs_url) || undefined,
		fix: clip(row.suggested_fix || row.fix || row.remediation) || undefined,
		confidence: confidenceText(row.confidence ?? row.score),
	};
}

function findingsFromUnknown(value: unknown): unknown[] {
	if (Array.isArray(value)) return value;
	const row = asRecord(value);
	if (!row) return [];
	if (Array.isArray(row.findings)) return row.findings;
	if (Array.isArray(row.results)) return row.results;
	const run = Array.isArray(row.runs) ? asRecord(row.runs[0]) : null;
	if (run && Array.isArray(run.results)) return run.results;
	return [];
}

function originLabel(row: Record<string, unknown>): string | undefined {
	const origin = asRecord(row.rules_origin);
	if (!origin) return clip(row.rules_origin) || undefined;
	if (origin.signed === true) {
		const channel = clip(origin.channel) || "unknown";
		return origin.custom === true ? `signed:${channel}:custom` : `signed:${channel}`;
	}
	if (origin.custom === true) return "unsigned:custom";
	if (origin.signed === false) return "unsigned:default";
	return undefined;
}

function parseReportSummary(value: unknown): ScannerReportSummary | undefined {
	const row = asRecord(value);
	if (!row) return undefined;
	const coverage = asRecord(row.coverage) || {};
	const scoreRaw = row.overall_score ?? row.overallScore;
	const overallScore =
		typeof scoreRaw === "number" && Number.isFinite(scoreRaw) ? scoreRaw : undefined;
	const summary: ScannerReportSummary = {
		scanId: clip(row.scan_id || row.scanId) || undefined,
		repo: clip(row.repo) || undefined,
		overallScore,
		rulesSource: clip(row.rules_source || row.rulesSource) || undefined,
		rulesVersion: clip(row.rules_version || row.rulesVersion).slice(0, 64) || undefined,
		rulesFromCache: row.rules_from_cache === true || row.rulesFromCache === true || undefined,
		rulesStale: row.rules_stale === true || row.rulesStale === true || undefined,
		rulesOrigin: originLabel(row),
		languages: stringList(row.languages),
		sdks: stringList(row.sdks || row.sdks_detected),
		toolCount: countArray(row.tools),
		agentCount: countArray(row.agents),
		mcpCount: countArray(row.mcp_servers || row.mcpServers),
		skillCount: countArray(row.skills),
		subagentCount: countArray(row.subagents),
		vulnerabilityCount: countArray(row.vulnerabilities),
		secretCount: countArray(row.secrets),
		filesParsed:
			typeof coverage.files_parsed === "number" ? coverage.files_parsed : undefined,
		filesSkipped:
			typeof coverage.files_skipped === "number" ? coverage.files_skipped : undefined,
		noAgentSurfaces: row.no_agent_surfaces === true || undefined,
	};
	return Object.values(summary).some((item) => item !== undefined) ? summary : undefined;
}

export function parseScannerReport(stdout: string): {
	findings: ScannerFinding[];
	mediumPlusCount: number;
	report?: ScannerReportSummary;
} {
	const trimmed = stdout.trim();
	if (!trimmed) return { findings: [], mediumPlusCount: 0 };
	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		const start = trimmed.indexOf("{");
		const end = trimmed.lastIndexOf("}");
		if (start < 0 || end <= start) return { findings: [], mediumPlusCount: 0 };
		try {
			parsed = JSON.parse(trimmed.slice(start, end + 1));
		} catch {
			return { findings: [], mediumPlusCount: 0 };
		}
	}
	const findings = findingsFromUnknown(parsed)
		.map(normalizeFinding)
		.filter((item): item is ScannerFinding => !!item)
		.slice(0, MAX_FINDINGS);
	const mediumPlusCount = findings.filter((item) => MEDIUM_PLUS.has(item.severity)).length;
	return { findings, mediumPlusCount, report: parseReportSummary(parsed) };
}

export function newScannerJobId(): string {
	return `job:${randomUUID()}`;
}

export function countMediumPlus(findings: ScannerFinding[]): number {
	return findings.filter((item) => MEDIUM_PLUS.has(item.severity)).length;
}

import { SCANNER_REPO_NOT_FOUND } from "@/constants/messages/en";

export function redactScannerText(value: string): string {
	return value
		.replace(/ghp_[A-Za-z0-9_]{20,}/g, "[redacted]")
		.replace(/github_pat_[A-Za-z0-9_]{20,}/g, "[redacted]")
		.replace(/xox[baprs]-[A-Za-z0-9-]{10,}/g, "[redacted]");
}

export function formatScannerError(value: string): string {
	const cleaned = redactScannerText(value)
		.replace(/^\s*Error:\s*/i, "")
		.split("\n")
		.map((line) => line.trim())
		.find(Boolean);
	if (!cleaned) return value.trim();
	if (/repository not found/i.test(cleaned) || /ingest:\s*clone/i.test(cleaned)) {
		return SCANNER_REPO_NOT_FOUND;
	}
	return cleaned.slice(0, 500);
}

export function summarizeJob(job: ScannerJob): ScannerJob {
	return {
		...job,
		findings: job.findings?.slice(0, MAX_FINDINGS),
	};
}
