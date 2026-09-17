import { normalizeScannerDetectors, normalizeScannerRef, normalizeScannerRulesRepo, normalizeScannerRulesSource, normalizeScannerTarget, scannerCloneTarget, scannerRefFromTarget, scannerRepoKey } from "@/lib/platform/connectors/scanner/target";

describe("scanner target validation", () => {
	it("accepts GitHub repository URLs", () => {
		expect(normalizeScannerTarget("https://github.com/acme/checkout-agent")).toBe(
			"https://github.com/acme/checkout-agent"
		);
		expect(
			normalizeScannerTarget("https://github.com/acme/checkout-agent/tree/main")
		).toBe("https://github.com/acme/checkout-agent/tree/main");
	});

	it("rejects local paths and non-GitHub URLs", () => {
		expect(() => normalizeScannerTarget(".")).toThrow(/github/i);
		expect(() => normalizeScannerTarget("/tmp/repo")).toThrow(/github/i);
		expect(() => normalizeScannerTarget("file:///etc/passwd")).toThrow(/github/i);
		expect(() => normalizeScannerTarget("https://gitlab.com/acme/repo")).toThrow(/github/i);
	});

	it("validates refs and detectors", () => {
		expect(normalizeScannerRef("main")).toBe("main");
		expect(() => normalizeScannerRef("main;rm -rf /")).toThrow();
		expect(normalizeScannerDetectors("claude_sdk, mcp")).toBe("claude_sdk,mcp");
		expect(() => normalizeScannerDetectors("claude_sdk,../etc")).toThrow();
	});

	it("strips /tree/ref so Trustabl clones a git remote, not a GitHub HTML URL", () => {
		expect(scannerCloneTarget("https://github.com/acme/checkout-agent/tree/main")).toBe(
			"https://github.com/acme/checkout-agent"
		);
		expect(scannerCloneTarget("https://github.com/acme/checkout-agent.git")).toBe(
			"https://github.com/acme/checkout-agent"
		);
		expect(scannerRefFromTarget("https://github.com/acme/checkout-agent/tree/develop")).toBe(
			"develop"
		);
	});

	it("normalizes GitHub URLs onto a repo key for coding-agent joins", () => {
		expect(scannerRepoKey("https://github.com/acme/checkout-agent")).toBe(
			"github.com/acme/checkout-agent"
		);
		expect(scannerRepoKey("https://github.com/Acme/checkout-agent.git")).toBe(
			"github.com/acme/checkout-agent"
		);
		expect(scannerRepoKey("https://github.com/acme/checkout-agent/tree/main")).toBe(
			"github.com/acme/checkout-agent"
		);
		expect(scannerRepoKey("git@github.com:acme/checkout-agent.git")).toBe(
			"github.com/acme/checkout-agent"
		);
		expect(scannerRepoKey("ssh://git@github.com/acme/checkout-agent")).toBe(
			"github.com/acme/checkout-agent"
		);
		expect(scannerRepoKey("https://gitlab.com/acme/checkout-agent")).toBeNull();
		expect(scannerRepoKey("")).toBeNull();
	});

	it("validates rules source and rules repo", () => {
		expect(normalizeScannerRulesSource("production")).toBe("production");
		expect(normalizeScannerRulesSource("environment")).toBeUndefined();
		expect(() => normalizeScannerRulesSource("nightly")).toThrow();
		expect(normalizeScannerRulesRepo("https://github.com/trustabl/trustabl-rules")).toBe(
			"https://github.com/trustabl/trustabl-rules"
		);
		expect(() => normalizeScannerRulesRepo("/tmp/rules")).toThrow();
	});
});
