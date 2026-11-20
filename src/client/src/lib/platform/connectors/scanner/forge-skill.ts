/**
 * Read a Trustabl Forge SKILL.md. Forge prints no stats, so the Skill panel's
 * counts and outline come from the Markdown itself:
 * `## section`, `### group`, `#### [RULE-ID] title`, `**Severity:** level`,
 * plus the `<!-- generated: … | rules: … -->` provenance stamp.
 */

import { formatScannerError } from "./report";
import type { ScannerForgeCheck, ScannerForgeSkillSummary } from "./types";

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const STAMP = /<!--\s*generated:([^>]*)-->/;
const RULE_HEADING = /^####\s+\[[^\]]+\]/;
const SEVERITY = /^\*\*Severity:\*\*\s*([A-Za-z]+)/;

type Severity = keyof ScannerForgeSkillSummary["severityCounts"];
const SEVERITIES = new Set<Severity>(["critical", "high", "medium", "low"]);

function frontMatterField(block: string, key: string): string | undefined {
	const lines = block.split(/\r?\n/);
	const index = lines.findIndex((line) => line.startsWith(`${key}:`));
	if (index < 0) return undefined;
	const inline = lines[index].slice(key.length + 1).trim();
	if (inline && inline !== ">-" && inline !== ">" && inline !== "|") return inline;
	const folded: string[] = [];
	for (const line of lines.slice(index + 1)) {
		if (!/^\s+\S/.test(line)) break;
		folded.push(line.trim());
	}
	return folded.join(" ") || undefined;
}

function parseStamp(content: string): ScannerForgeSkillSummary["stamp"] {
	const match = content.match(STAMP);
	if (!match) return undefined;
	const fields: Record<string, string> = {};
	const parts = `generated:${match[1]}`.split("|");
	for (const part of parts) {
		const separator = part.indexOf(":");
		if (separator < 0) continue;
		fields[part.slice(0, separator).trim().toLowerCase()] = part.slice(separator + 1).trim();
	}
	const sdks = fields.sdks
		?.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
	return {
		generated: fields.generated || undefined,
		rulesSha: fields.rules || undefined,
		schema: fields.schema || undefined,
		sdks: sdks?.length ? sdks : undefined,
	};
}

export function parseForgeSkill(content: string): ScannerForgeSkillSummary {
	const text = String(content || "");
	const front = text.match(FRONT_MATTER)?.[1];
	const summary: ScannerForgeSkillSummary = {
		name: front ? frontMatterField(front, "name") : undefined,
		description: front ? frontMatterField(front, "description") : undefined,
		stamp: parseStamp(text),
		ruleCount: 0,
		severityCounts: { critical: 0, high: 0, medium: 0, low: 0 },
		sections: [],
		lineCount: text ? text.split("\n").length : 0,
		byteLength: Buffer.byteLength(text),
	};
	let section: ScannerForgeSkillSummary["sections"][number] | undefined;
	let group: ScannerForgeSkillSummary["sections"][number]["groups"][number] | undefined;
	let pendingSeverity = false;
	let inFence = false;

	const settleSeverity = (severity: Severity) => {
		summary.severityCounts[severity] += 1;
		pendingSeverity = false;
	};

	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trimEnd();
		if (line.startsWith("```")) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;
		if (RULE_HEADING.test(line)) {
			if (pendingSeverity) settleSeverity("low");
			summary.ruleCount += 1;
			if (section) section.ruleCount += 1;
			if (group) group.ruleCount += 1;
			pendingSeverity = true;
			continue;
		}
		if (line.startsWith("### ")) {
			if (!section) continue;
			group = { title: line.slice(4).trim(), ruleCount: 0 };
			section.groups.push(group);
			continue;
		}
		if (line.startsWith("## ")) {
			section = { title: line.slice(3).trim(), ruleCount: 0, groups: [] };
			group = undefined;
			summary.sections.push(section);
			continue;
		}
		const severity = pendingSeverity ? line.match(SEVERITY)?.[1].toLowerCase() : undefined;
		if (severity) {
			settleSeverity(SEVERITIES.has(severity as Severity) ? (severity as Severity) : "low");
		}
	}
	if (pendingSeverity) settleSeverity("low");
	return summary;
}

/** Markdown for the rendered preview: no YAML front matter, no stamp comment. */
export function forgeSkillPreviewMarkdown(content: string): string {
	return String(content || "")
		.replace(FRONT_MATTER, "")
		.split(/\r?\n/)
		.filter((line) => !STAMP.test(line))
		.join("\n")
		.replace(/^\s+/, "");
}

export function parseForgeCheckOutput(
	exitCode: number,
	stdout: string,
	stderr: string
): ScannerForgeCheck {
	const status = exitCode === 0 ? "current" : exitCode === 1 ? "stale" : "error";
	const source = String(stdout || "").trim() || String(stderr || "").trim();
	return {
		status,
		message: source ? formatScannerError(source) : "",
		checkedAt: new Date().toISOString(),
	};
}
