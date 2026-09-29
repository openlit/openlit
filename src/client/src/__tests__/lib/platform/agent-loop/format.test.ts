import {
	agentLoopCountLine,
	agentLoopDetailLine,
	agentLoopTipMeaning,
} from "@/lib/platform/agent-loop/format";

describe("agent loop copy", () => {
	it("explains the threshold in plain language", () => {
		expect(agentLoopTipMeaning()).toMatch(/at least 3 times/i);
	});

	it("shows count over eligible tool traces", () => {
		expect(agentLoopCountLine(4, 20)).toMatch(/4 of 20/);
		expect(agentLoopCountLine(0, 20)).toMatch(/None of 20/);
		expect(agentLoopCountLine(0, 0)).toMatch(/tool calls/i);
	});

	it("renders wasted tokens and cost on the detail line", () => {
		expect(
			agentLoopDetailLine({
				toolName: "search",
				count: 7,
				wastedTokens: 1200,
				wastedCost: 0.42,
			})
		).toBe("search repeated 7 times — 1200 tokens / $0.4200 wasted.");
	});

	it("renders 0 instead of NaN for ClickHouse nan / missing metrics", () => {
		expect(agentLoopCountLine(NaN, NaN)).toMatch(/tool calls/i);
		expect(agentLoopCountLine(Number("nan"), 20)).toMatch(/None of 20/);
		expect(
			agentLoopDetailLine({
				toolName: "search",
				count: Number.NaN,
				wastedTokens: Number.NaN,
				wastedCost: Number.NaN,
			})
		).toBe("search repeated 0 times — 0 tokens / $0.0000 wasted.");
	});
});
