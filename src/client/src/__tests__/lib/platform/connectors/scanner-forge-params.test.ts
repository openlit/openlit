import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	FORGE_DEFAULT_FILE_NAME,
	buildScannerForgeArgv,
	forgeCommandPreview,
	normalizeForgeFileName,
	normalizeForgePolicies,
	parseScannerForgeInput,
} from "@/lib/platform/connectors/scanner/forge-params";
import {
	forgeCliSchemaFromHelp,
	parseForgeAcceptedPolicies,
	type ScannerForgeSchema,
} from "@/lib/platform/connectors/scanner/cli-schema";
import {
	SCANNER_FORGE_FILE_NAME_INVALID,
	SCANNER_FORGE_POLICY_INVALID,
} from "@/constants/messages/en";

const FORGE_HELP = readFileSync(
	join(__dirname, "../../../fixtures/trustabl/forge-help.txt"),
	"utf8"
);

function schemaWith(flags: string[]): ScannerForgeSchema {
	return {
		policies: ["claude_sdk", "mcp"],
		flags: flags.map((flag) => ({
			flag,
			key: flag.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()),
			kind: flag === "some-flag" ? "boolean" : "string",
			group: "rules",
			help: "",
		})),
	};
}

describe("normalizeForgePolicies", () => {
	it("lowercases, trims, and dedupes comma strings and arrays", () => {
		expect(normalizeForgePolicies("Claude_SDK, mcp,mcp")).toEqual(["claude_sdk", "mcp"]);
		expect(normalizeForgePolicies([" mcp ", "claude_skill"])).toEqual(["mcp", "claude_skill"]);
	});

	it("returns an empty list for missing input", () => {
		expect(normalizeForgePolicies(undefined)).toEqual([]);
		expect(normalizeForgePolicies("")).toEqual([]);
	});

	it("rejects ids that are not policy ids", () => {
		expect(() => normalizeForgePolicies(["bad-id"])).toThrow(SCANNER_FORGE_POLICY_INVALID);
		expect(() => normalizeForgePolicies("mcp,--output")).toThrow(SCANNER_FORGE_POLICY_INVALID);
	});

	it("rejects more than 32 policies", () => {
		const many = Array.from({ length: 33 }, (_, i) => `p${i}`);
		expect(() => normalizeForgePolicies(many)).toThrow(SCANNER_FORGE_POLICY_INVALID);
	});
});

describe("normalizeForgeFileName", () => {
	it("defaults to SKILL.md", () => {
		expect(normalizeForgeFileName("")).toBe(FORGE_DEFAULT_FILE_NAME);
		expect(normalizeForgeFileName(undefined)).toBe("SKILL.md");
	});

	it("accepts plain markdown file names", () => {
		expect(normalizeForgeFileName(" pre-coding.md ")).toBe("pre-coding.md");
	});

	it("rejects paths and non-markdown names", () => {
		expect(() => normalizeForgeFileName("../x.md")).toThrow(SCANNER_FORGE_FILE_NAME_INVALID);
		expect(() => normalizeForgeFileName("dir/x.md")).toThrow(SCANNER_FORGE_FILE_NAME_INVALID);
		expect(() => normalizeForgeFileName("a.txt")).toThrow(SCANNER_FORGE_FILE_NAME_INVALID);
	});
});

describe("parseScannerForgeInput", () => {
	it("keeps trimmed fields and drops unknown keys", () => {
		expect(
			parseScannerForgeInput({
				target: " https://github.com/acme/agent ",
				policies: "mcp",
				rulesRef: " main ",
				fileName: "SKILL.md",
				sourceJobId: "job:1",
				extras: { someFlag: true, bad: "-x" },
				other: "ignored",
			})
		).toEqual({
			target: "https://github.com/acme/agent",
			policies: ["mcp"],
			rulesRef: "main",
			fileName: "SKILL.md",
			sourceJobId: "job:1",
			extras: { someFlag: true },
		});
	});

	it("leaves policies undefined when none are sent", () => {
		expect(parseScannerForgeInput({}).policies).toBeUndefined();
	});
});

describe("buildScannerForgeArgv", () => {
	const params = {
		policies: ["claude_sdk", "mcp"],
		fileName: "SKILL.md",
		rulesRef: "v1",
		extras: { output: "x", someFlag: true },
	};

	it("passes policies, rules ref, and schema-listed extras", () => {
		expect(buildScannerForgeArgv(params, schemaWith(["rules-ref", "some-flag"]))).toEqual([
			"forge",
			"--policy",
			"claude_sdk,mcp",
			"--rules-ref",
			"v1",
			"--some-flag",
		]);
	});

	it("never forwards blocked flags and drops unknown flags without a schema", () => {
		expect(buildScannerForgeArgv(params)).toEqual([
			"forge",
			"--policy",
			"claude_sdk,mcp",
			"--rules-ref",
			"v1",
		]);
	});

	it("renders a command preview", () => {
		expect(forgeCommandPreview(["forge", "--policy", "mcp"])).toBe("trustabl forge --policy mcp");
	});
});

describe("forge CLI schema", () => {
	it("parses accepted policies from CLI errors", () => {
		expect(
			parseForgeAcceptedPolicies(
				'trustabl forge: no SDKs detected\n  accepted categories: [claude_sdk openai_sdk mcp]\n'
			)
		).toEqual(["claude_sdk", "openai_sdk", "mcp"]);
		expect(
			parseForgeAcceptedPolicies('unknown policy category "x"; accepted values: [mcp crewai]')
		).toEqual(["mcp", "crewai"]);
		expect(parseForgeAcceptedPolicies("garbage")).toEqual([]);
	});

	it("keeps rules-ref and drops flags OpenLIT owns", () => {
		const schema = forgeCliSchemaFromHelp(FORGE_HELP, ["mcp"], "v0.1.8");
		const flags = schema.flags.map((item) => item.flag);
		expect(flags).toContain("rules-ref");
		for (const blocked of ["output", "policy", "verbose", "debug", "help"]) {
			expect(flags).not.toContain(blocked);
		}
		expect(schema.policies).toEqual(["mcp"]);
		expect(schema.version).toBe("v0.1.8");
	});
});
