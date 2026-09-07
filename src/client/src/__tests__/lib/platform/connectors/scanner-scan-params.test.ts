import { parseScannerScanInput, resolveScannerScanParams } from "@/lib/platform/connectors/scanner/scan-params";

describe("scanner scan params", () => {
	it("parses Trustabl scan flags from a JSON body", () => {
		expect(
			parseScannerScanInput({
				target: "https://github.com/acme/checkout-agent",
				strict: true,
				secretScan: "true",
				rulesSource: "staging",
			})
		).toEqual(
			expect.objectContaining({
				target: "https://github.com/acme/checkout-agent",
				strict: true,
				secretScan: true,
				rulesSource: "staging",
			})
		);
	});

	it("uses per-run overrides over connector defaults and environment rules source", () => {
		const params = resolveScannerScanParams(
			{ detectors: "mcp", strict: true, rulesSource: "environment" },
			{ detectors: "claude_sdk", strict: false, requireSigned: false, secretScan: true },
			"staging"
		);
		expect(params.detectors).toBe("mcp");
		expect(params.strict).toBe(true);
		expect(params.secretScan).toBe(true);
		expect(params.requireSigned).toBe(false);
		expect(params.rulesSource).toBe("staging");
	});
});
