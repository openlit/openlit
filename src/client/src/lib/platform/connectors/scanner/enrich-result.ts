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
	/** The model's proposed range and text, returned even when the CLI did not apply them. */
	lineStart?: number;
	lineEnd?: number;
	replacement?: string;
	falsePositive?: boolean;
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
		if (Number.isInteger(row.line_start)) output.lineStart = row.line_start as number;
		if (Number.isInteger(row.line_end)) output.lineEnd = row.line_end as number;
		if (typeof row.replacement === "string" && row.replacement) output.replacement = row.replacement;
		if (row.false_positive === true) output.falsePositive = true;
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

function trailingBlankLines(lines: string[]): number {
	let count = 0;
	for (let index = lines.length - 1; index >= 0 && !lines[index].trim(); index -= 1) count += 1;
	return count;
}

/**
 * Splices the model's replacement over lines lineStart..lineEnd (1-based), as
 * `trustabl enrich --apply` would. Blank lines that close the range and are
 * missing from the replacement are kept, and a CRLF range stays CRLF. Returns
 * null when the range or replacement is unusable or nothing would change.
 */
export function applyEnrichReplacement(
	content: string,
	lineStart: number,
	lineEnd: number,
	replacement: string
): string | null {
	const lines = content.split("\n");
	if (
		!Number.isInteger(lineStart) ||
		!Number.isInteger(lineEnd) ||
		lineStart < 1 ||
		lineStart > lineEnd ||
		lineEnd > lines.length
	) {
		return null;
	}
	const text = replacement.replace(/\n+$/, "");
	if (!text) return null;
	const range = lines.slice(lineStart - 1, lineEnd);
	let next = text.split("\n");
	if (range.every((line) => line.endsWith("\r"))) {
		next = next.map((line) => (line.endsWith("\r") ? line : `${line}\r`));
	}
	const kept = Math.min(Math.max(0, trailingBlankLines(range) - trailingBlankLines(next)), lineEnd - lineStart);
	const result = [...lines.slice(0, lineStart - 1), ...next, ...lines.slice(lineEnd - kept)].join("\n");
	return result === content ? null : result;
}

/** One-hunk unified diff of a single contiguous change, with three lines of context. */
export function unifiedLineDiff(path: string, before: string, after: string): string {
	const context = 3;
	const a = before.split("\n");
	const b = after.split("\n");
	// A final newline splits into a trailing "" that is not a line of its own.
	if (a[a.length - 1] === "") a.pop();
	if (b[b.length - 1] === "") b.pop();
	let prefix = 0;
	while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1;
	let suffix = 0;
	while (
		suffix < a.length - prefix &&
		suffix < b.length - prefix &&
		a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
	) {
		suffix += 1;
	}
	const removed = a.slice(prefix, a.length - suffix);
	const added = b.slice(prefix, b.length - suffix);
	if (!removed.length && !added.length) return "";
	const leading = a.slice(Math.max(0, prefix - context), prefix);
	const trailing = a.slice(a.length - suffix, a.length - suffix + context);
	const start = prefix - leading.length + 1;
	return [
		`--- a/${path}`,
		`+++ b/${path}`,
		`@@ -${start},${leading.length + removed.length + trailing.length} +${start},${leading.length + added.length + trailing.length} @@`,
		...leading.map((line) => ` ${line}`),
		...removed.map((line) => `-${line}`),
		...added.map((line) => `+${line}`),
		...trailing.map((line) => ` ${line}`),
		"",
	].join("\n");
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
