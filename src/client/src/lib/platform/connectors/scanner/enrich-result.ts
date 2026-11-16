/**
 * Pure helpers for Enrich: identify a finding across scans, build the
 * one-finding ScanResult `trustabl enrich` reads, and interpret its output.
 *
 * Trustabl findings carry no id, so a finding is identified by its rule, file,
 * tool, and scope. The line is left out because an edit above it moves it.
 */

import { redactScannerText } from "./report";
import type { ScannerFinding } from "./types";

const MAX_TEXT = 2_000;
const MAX_PROVIDER_ERROR = 500;

type RawRow = Record<string, unknown>;

function asRecord(value: unknown): RawRow | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as RawRow) : null;
}

function text(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function rawFindings(report: RawRow): RawRow[] {
	return Array.isArray(report.findings)
		? report.findings.map(asRecord).filter((row): row is RawRow => !!row)
		: [];
}

export function scannerFindingKey(finding: {
	ruleId: string;
	path?: string;
	toolName?: string;
	scope?: string;
}): string {
	return [finding.ruleId, finding.path || "", finding.toolName || "", finding.scope || ""].join("|");
}

export function rawFindingKey(row: RawRow): string {
	return scannerFindingKey({
		ruleId: text(row.rule_id),
		path: text(row.file_path),
		toolName: text(row.tool_name),
		scope: text(row.scope),
	});
}

export function locateRawFinding(report: RawRow, finding: ScannerFinding): RawRow | null {
	const key = scannerFindingKey(finding);
	const line = finding.line || 0;
	let best: RawRow | null = null;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const row of rawFindings(report)) {
		if (rawFindingKey(row) !== key) continue;
		const distance = Math.abs((Number(row.start_line) || 0) - line);
		if (distance < bestDistance) {
			best = row;
			bestDistance = distance;
		}
	}
	return best;
}

export function singleFindingReport(report: RawRow, row: RawRow): RawRow {
	return { ...report, findings: [row] };
}

export function redactEnrichText(value: string): string {
	return redactScannerText(value)
		.replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, "[redacted]")
		.replace(/sk-[A-Za-z0-9_-]{16,}/g, "[redacted]")
		.replace(/AIza[A-Za-z0-9_-]{20,}/g, "[redacted]");
}

export interface ScannerEnrichOutput {
	enriched: boolean;
	applied: boolean;
	explanation?: string;
	fixSummary?: string;
	diff?: string;
	providerError?: string;
}

function providerError(stderr: string): string | undefined {
	const line = stderr
		.split("\n")
		.map((item) => item.trim())
		.find((item) => item.startsWith("warn: llm enrich"));
	if (!line) return undefined;
	return redactEnrichText(line.replace(/^warn:\s*/, "")).slice(0, MAX_PROVIDER_ERROR);
}

export function parseEnrichOutput(stdout: string, stderr: string): ScannerEnrichOutput {
	let parsed: RawRow | null = null;
	try {
		parsed = asRecord(JSON.parse(stdout));
	} catch {
		parsed = null;
	}
	const row = parsed ? rawFindings(parsed)[0] : undefined;
	const output: ScannerEnrichOutput = {
		enriched: row?.enriched === true,
		applied: row?.applied === true,
	};
	if (row) {
		const explanation = text(row.ai_explanation).slice(0, MAX_TEXT);
		const fixSummary = text(row.ai_fix).slice(0, MAX_TEXT);
		const diff = typeof row.diff === "string" ? row.diff : "";
		if (explanation) output.explanation = explanation;
		if (fixSummary) output.fixSummary = fixSummary;
		if (diff) output.diff = diff;
	}
	const error = providerError(stderr);
	if (error) output.providerError = error;
	return output;
}

export function compareRecheck(
	before: RawRow,
	after: RawRow,
	key: string
): { resolved: boolean; newFindings: number } {
	const remaining = new Map<string, number>();
	for (const row of rawFindings(before)) {
		const rowKey = rawFindingKey(row);
		remaining.set(rowKey, (remaining.get(rowKey) || 0) + 1);
	}
	let resolved = true;
	let newFindings = 0;
	for (const row of rawFindings(after)) {
		const rowKey = rawFindingKey(row);
		if (rowKey === key) resolved = false;
		const count = remaining.get(rowKey) || 0;
		if (count > 0) remaining.set(rowKey, count - 1);
		else newFindings += 1;
	}
	return { resolved, newFindings };
}

export function diffStats(diff: string): { additions: number; deletions: number } {
	let additions = 0;
	let deletions = 0;
	for (const line of diff.split("\n")) {
		if (line.startsWith("+++") || line.startsWith("---")) continue;
		if (line.startsWith("+")) additions += 1;
		else if (line.startsWith("-")) deletions += 1;
	}
	return { additions, deletions };
}
