import {
	CODING_AGENT_CLASSIFICATION_DESCRIPTIONS,
	CODING_AGENT_CLASSIFICATION_LABELS,
	CODING_AGENT_CLASSIFICATION_REASON_LABELS,
	isCodingAgentClassification,
	validateClassificationDispute,
} from "@/lib/platform/coding-agents/classifier";

describe("coding agent classifier helpers", () => {
	it("exposes stable labels and descriptions", () => {
		expect(CODING_AGENT_CLASSIFICATION_LABELS.work).toBe("Work");
		expect(CODING_AGENT_CLASSIFICATION_DESCRIPTIONS.personal).toContain(
			"outside the org's API-key/repo allowlist"
		);
		expect(CODING_AGENT_CLASSIFICATION_REASON_LABELS.no_signal).toBe(
			"No classification signal available"
		);
	});

	it("narrows valid classification values", () => {
		for (const value of ["personal", "work", "disputed", "unknown"]) {
			expect(isCodingAgentClassification(value)).toBe(true);
		}

		expect(isCodingAgentClassification("invalid")).toBe(false);
		expect(isCodingAgentClassification(null)).toBe(false);
	});

	it.each([
		[{}, "sessionId is required."],
		[
			{ sessionId: "s1", currentClassification: "bad" },
			"currentClassification is invalid.",
		],
		[
			{ sessionId: "s1", currentClassification: "work" },
			"requestedClassification is invalid.",
		],
		[
			{
				sessionId: "s1",
				currentClassification: "work",
				requestedClassification: "work",
			},
			"Requested classification must differ from the current one.",
		],
		[
			{
				sessionId: "s1",
				currentClassification: "work",
				requestedClassification: "disputed",
			},
			"Cannot dispute toward 'disputed' — choose work, personal, or unknown.",
		],
		[
			{
				sessionId: "s1",
				currentClassification: "work",
				requestedClassification: "personal",
				rationale: " no ",
			},
			"A short rationale (at least 4 characters) is required.",
		],
		[
			{
				sessionId: "s1",
				currentClassification: "work",
				requestedClassification: "personal",
				rationale: "x".repeat(1001),
			},
			"Rationale must be 1000 characters or fewer.",
		],
	])("rejects invalid dispute payload %#", (payload, error) => {
		expect(validateClassificationDispute(payload as any)).toBe(error);
	});

	it("accepts valid dispute payloads", () => {
		expect(
			validateClassificationDispute({
				sessionId: "s1",
				currentClassification: "work",
				requestedClassification: "personal",
				rationale: "This was a personal project.",
			})
		).toBeNull();
	});
});
