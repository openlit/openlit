import {
	humanizeScannerFlag,
	keyFromFlag,
	parseTrustablScanHelp,
	schemaAllowsFlag,
	scannerCliSchemaFromHelp,
} from "@/lib/platform/connectors/scanner/cli-schema";
import { trustablConfigFields } from "@/lib/platform/connectors/scanner/config-fields";
import { buildScannerScanArgv } from "@/lib/platform/connectors/scanner/scan-params";

const HELP = `
Scan a GitHub repository or local path.

Flags:
      --detectors string           comma-separated detector categories (default: all)
      --format string              output format: human|json|sarif (default "human")
  -o, --output string              write the report to a file
      --strict                     exit 1 on any finding of low severity or higher
      --secret-scan                scan all text files for hardcoded secrets
      --sbom-scan                  generate an SBOM and attach inventory findings
      --rules-source string        rules source: git, production, staging
      --channel string             deprecated alias for --rules-source
      --require-signed             refuse unsigned rules (default true)
      --json-out string            also write JSON to this file
      --attest                     sign the JSON report
  -h, --help                       help for scan

Global Flags:
  -v, --verbose                    verbose diagnostics
`;

describe("Trustabl CLI schema", () => {
	it("parses scan help into form fields and hides blocked or deprecated flags", () => {
		const flags = parseTrustablScanHelp(HELP);
		expect(flags.map((item) => item.flag)).toEqual([
			"detectors",
			"strict",
			"secret-scan",
			"sbom-scan",
			"rules-source",
			"require-signed",
			"verbose",
		]);
		expect(flags.find((item) => item.flag === "sbom-scan")).toMatchObject({
			key: "sbomScan",
			kind: "boolean",
		});
		expect(flags.find((item) => item.flag === "require-signed")?.defaultValue).toBe(true);
		expect(flags.some((item) => item.flag === "format" || item.flag === "channel")).toBe(false);
	});

	it("adds new CLI flags to the connector form and keeps OpenLIT-owned fields", () => {
		const schema = scannerCliSchemaFromHelp(HELP, "v0.2.0");
		const keys = trustablConfigFields(schema).map((field) => field.key);
		expect(keys).toContain("target");
		expect(keys).toContain("githubToken");
		expect(keys).toContain("sbomScan");
		expect(keys).not.toContain("jsonOut");
		expect(humanizeScannerFlag("sbom-scan")).toBe("Sbom Scan");
		expect(keyFromFlag("secret-scan")).toBe("secretScan");
	});

	it("only forwards extra flags the installed CLI advertised", () => {
		const schema = scannerCliSchemaFromHelp(HELP);
		expect(schemaAllowsFlag(schema, "sbom-scan")).toBe(true);
		expect(schemaAllowsFlag(undefined, "sbom-scan")).toBe(false);
		expect(
			buildScannerScanArgv(
				"https://github.com/acme/repo",
				{ extras: { sbomScan: true, jsonOut: "/tmp/out.json" } },
				schema
			)
		).toEqual([
			"scan",
			"https://github.com/acme/repo",
			"--format",
			"json",
			"--no-progress",
			"--no-color",
			"--sbom-scan",
		]);
	});
});
