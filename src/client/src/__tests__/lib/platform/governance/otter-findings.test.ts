jest.mock("@/lib/platform/chat/improvement", () => ({
	getTraceAnalysisRuns: jest.fn(),
}));

import { getTraceAnalysisRuns } from "@/lib/platform/chat/improvement";
import { loadOtterSecurityFindings } from "@/lib/platform/governance/otter-findings";

const mockedRuns = getTraceAnalysisRuns as jest.MockedFunction<
	typeof getTraceAnalysisRuns
>;

describe("loadOtterSecurityFindings", () => {
	beforeEach(() => {
		mockedRuns.mockReset();
	});

	it("returns empty when no runs exist", async () => {
		mockedRuns.mockResolvedValue({ data: [] });
		const result = await loadOtterSecurityFindings("root");
		expect(result.findings).toEqual([]);
		expect(result.otter_run_id).toBeUndefined();
	});

	it("maps prompt_injection and tool_misuse from the latest run", async () => {
		mockedRuns.mockResolvedValue({
			data: [
				{
					id: "run-1",
					rootSpanId: "root",
					selectedSpanId: "root",
					runNumber: 1,
					analysisJson: JSON.stringify({
						prompt_injection: [
							{
								id: "pi-1",
								severity: "critical",
								summary: "Injection risk",
								detail: "Untrusted instruction followed",
								span_refs: ["s1"],
								suggested_fix: "Harden the system prompt",
							},
						],
						tool_misuse: [
							{
								id: "tm-1",
								severity: "major",
								summary: "Risky tool",
								detail: "Shell without allowlist",
								span_refs: ["s2"],
							},
						],
					}),
					summary: "",
					modelProvider: "openai",
					modelName: "gpt-4o",
					promptTokens: 0,
					completionTokens: 0,
					cost: 0,
					worstSeverity: "critical",
					createdAt: new Date().toISOString(),
				},
			],
		});

		const result = await loadOtterSecurityFindings("root", "db-1");
		expect(mockedRuns).toHaveBeenCalledWith("root", "db-1", "trace_analysis");
		expect(result.otter_run_id).toBe("run-1");
		expect(result.findings).toHaveLength(2);
		expect(result.findings[0].category).toBe("prompt_injection");
		expect(result.findings[0].remediation).toBe("Harden the system prompt");
		expect(result.findings[1].category).toBe("tool_misuse");
		expect(result.findings[1].evidence?.source).toBe("otter");
	});
});
