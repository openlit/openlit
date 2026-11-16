import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	__resetScannerCliSchemaCacheForTests,
	probeTrustablRuntime,
} from "@/lib/platform/connectors/scanner/runtime";
import {
	__resetScannerProcessRunnerForTests,
	setScannerProcessRunnerForTests,
	type ScannerProcessRunInput,
} from "@/lib/platform/connectors/scanner/process";

const FORGE_HELP = readFileSync(join(__dirname, "../../../fixtures/trustabl/forge-help.txt"), "utf8");
const ACCEPTED =
	'trustabl forge: no SDKs detected in "." and no --policy specified\n' +
	"  accepted categories: [claude_sdk openai_sdk openshell google_adk mcp langchain crewai pydantic_ai vercel_ai autogen claude_skill]\n";

describe("Trustabl runtime forge schema", () => {
	const previousBin = process.env.TRUSTABL_BIN;
	const previousCache = process.env.OPENLIT_RUNTIME_CACHE;
	let root: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "openlit-forge-runtime-"));
		const bin = join(root, "trustabl");
		writeFileSync(bin, "");
		process.env.TRUSTABL_BIN = bin;
		process.env.OPENLIT_RUNTIME_CACHE = join(root, "cache");
		__resetScannerCliSchemaCacheForTests();
	});

	afterEach(() => {
		__resetScannerProcessRunnerForTests();
		process.env.TRUSTABL_BIN = previousBin;
		process.env.OPENLIT_RUNTIME_CACHE = previousCache;
		rmSync(root, { recursive: true, force: true });
	});

	function fakeCli(forge: (input: ScannerProcessRunInput) => { exitCode: number; stdout: string; stderr: string }) {
		const calls: ScannerProcessRunInput[] = [];
		setScannerProcessRunnerForTests({
			run: async (input) => {
				calls.push(input);
				if (input.argv[0] === "version") return { exitCode: 0, stdout: "Trustabl 0.1.8\n", stderr: "" };
				if (input.argv[0] === "scan") {
					return { exitCode: 0, stdout: "Flags:\n      --strict   exit 1 on findings\n", stderr: "" };
				}
				return forge(input);
			},
		});
		return calls;
	}

	it("reads forge flags and accepted policies from the installed CLI", async () => {
		const calls = fakeCli((input) => {
			if (input.argv.join(" ") === "forge --help") return { exitCode: 0, stdout: FORGE_HELP, stderr: "" };
			return { exitCode: 1, stdout: "", stderr: ACCEPTED };
		});
		const runtime = await probeTrustablRuntime();
		expect(runtime.forge?.flags.map((item) => item.flag)).toEqual(["rules-ref"]);
		expect(runtime.forge?.policies).toHaveLength(11);
		expect(runtime.forge?.policies).toContain("claude_skill");
		const policyProbe = calls.find((call) => call.argv.join(" ") === "forge");
		expect(policyProbe?.cwd).toBeDefined();
		expect(policyProbe?.cwd?.startsWith(tmpdir())).toBe(true);
		expect(readdirSync(tmpdir()).some((name) => policyProbe?.cwd?.endsWith(name))).toBe(false);
	});

	it("omits the forge schema when the CLI has no forge command", async () => {
		fakeCli(() => ({ exitCode: 1, stdout: "", stderr: 'Error: unknown command "forge"' }));
		const runtime = await probeTrustablRuntime();
		expect(runtime.installed).toBe(true);
		expect(runtime.forge).toBeUndefined();
	});
});
