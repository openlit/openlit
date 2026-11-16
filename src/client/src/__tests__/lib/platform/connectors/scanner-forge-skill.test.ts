import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	forgeSkillPreviewMarkdown,
	parseForgeCheckOutput,
	parseForgeSkill,
} from "@/lib/platform/connectors/scanner/forge-skill";

const SKILL = readFileSync(join(__dirname, "../../../fixtures/trustabl/forge-skill.md"), "utf8");

describe("parseForgeSkill", () => {
	const summary = parseForgeSkill(SKILL);

	it("reads front matter and the provenance stamp", () => {
		expect(summary.name).toBe("trustabl-pre-coding");
		expect(summary.description).toBe("Pre-coding reliability constraints for: claude_sdk, mcp");
		expect(summary.stamp?.rulesSha).toMatch(/^[0-9a-f]{40}$/);
		expect(summary.stamp?.schema).toBe("41");
		expect(summary.stamp?.generated).toBe("2026-11-10");
		expect(summary.stamp?.sdks).toEqual(["claude_sdk", "mcp"]);
	});

	it("counts rules per section, group, and severity", () => {
		expect(summary.ruleCount).toBe(75);
		expect(summary.severityCounts).toEqual({ critical: 0, high: 33, medium: 11, low: 31 });
		expect(summary.sections.map((section) => section.title)).toEqual([
			"Claude Agent SDK subagent wiring safety",
			"MCP dynamic code execution",
		]);
		expect(summary.sections[0].groups[0]).toEqual({ title: "Tool Rules", ruleCount: 24 });
		const sectionTotal = summary.sections.reduce((sum, section) => sum + section.ruleCount, 0);
		expect(sectionTotal).toBe(75);
	});

	it("reports size", () => {
		expect(summary.byteLength).toBe(Buffer.byteLength(SKILL));
		expect(summary.lineCount).toBe(SKILL.split("\n").length);
	});

	it("tolerates files without front matter, stamp, or severity lines", () => {
		const partial = parseForgeSkill("# x\r\n#### [A-1] t\r\n");
		expect(partial.ruleCount).toBe(1);
		expect(partial.severityCounts.low).toBe(1);
		expect(partial.stamp).toBeUndefined();
		expect(partial.name).toBeUndefined();
		expect(partial.sections).toEqual([]);
	});

	it("returns zero counts for empty content", () => {
		expect(parseForgeSkill("").ruleCount).toBe(0);
	});
});

describe("forgeSkillPreviewMarkdown", () => {
	it("drops front matter and the stamp comment", () => {
		const preview = forgeSkillPreviewMarkdown(SKILL);
		expect(preview.startsWith("# Trustabl")).toBe(true);
		expect(preview).not.toContain("name: trustabl-pre-coding");
		expect(preview).not.toContain("<!--");
	});
});

describe("parseForgeCheckOutput", () => {
	it("maps exit 0 to current", () => {
		expect(parseForgeCheckOutput(0, "up to date (rules: 9eca09d, generated: 2026-11-10)\n", "")).toMatchObject({
			status: "current",
			message: "up to date (rules: 9eca09d, generated: 2026-11-10)",
		});
	});

	it("maps exit 1 to stale with the first line", () => {
		expect(
			parseForgeCheckOutput(
				1,
				"outdated: generated from 0000000, current rules are 9eca09d\nregenerate: trustabl forge --output SKILL.md\n",
				""
			)
		).toMatchObject({
			status: "stale",
			message: "outdated: generated from 0000000, current rules are 9eca09d",
		});
	});

	it("maps other exits to error and falls back to stderr", () => {
		const check = parseForgeCheckOutput(2, "", "boom\nmore");
		expect(check.status).toBe("error");
		expect(check.message).toBe("boom");
		expect(Number.isNaN(Date.parse(check.checkedAt))).toBe(false);
	});
});
