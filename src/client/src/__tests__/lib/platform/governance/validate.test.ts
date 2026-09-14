import {
	GOVERNANCE_SPAN_ID_MAX_LENGTH,
	validateGovernanceSpanId,
} from "@/lib/platform/governance/validate";

describe("validateGovernanceSpanId", () => {
	it("accepts standard otel span ids", () => {
		expect(validateGovernanceSpanId("a1b2c3d4e5f6a7b8")).toBe("a1b2c3d4e5f6a7b8");
		expect(validateGovernanceSpanId("synthetic-session-1")).toBe(
			"synthetic-session-1"
		);
	});

	it("rejects empty, oversized, and injection-prone values", () => {
		expect(validateGovernanceSpanId("")).toBeNull();
		expect(validateGovernanceSpanId("   ")).toBeNull();
		expect(
			validateGovernanceSpanId("x".repeat(GOVERNANCE_SPAN_ID_MAX_LENGTH + 1))
		).toBeNull();
		expect(validateGovernanceSpanId("'; DROP TABLE--")).toBeNull();
		expect(validateGovernanceSpanId("span\nid")).toBeNull();
	});
});
