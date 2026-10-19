import { signalMatchesConditions } from "@/lib/platform/realtime/match";
import type { LiveSignal } from "@/lib/platform/realtime/signals";

const signal: LiveSignal = {
	timestamp: "2026-10-14T10:00:00Z",
	service: "checkout-bot",
	spanName: "chat gpt-4o",
	operation: "chat",
	provider: "openai",
	model: "gpt-4o",
	durationMs: 4200,
	status: "error",
	httpStatus: 500,
	inputTokens: 100,
	outputTokens: 50,
	totalTokens: 150,
	cost: 0.5,
	traceId: "t",
	spanId: "s",
	attributes: { "http.route": "/chat", "gen_ai.request.temperature": "0.7" },
};

const match = (field: string, op: string, values: string[] = []) =>
	signalMatchesConditions(signal, [{ field, op, values }], "production");

describe("signalMatchesConditions (engine parity)", () => {
	it("matches every span when there are no conditions", () => {
		expect(signalMatchesConditions(signal, [], "production")).toBe(true);
	});

	it("compares strings case-insensitively like the engine", () => {
		expect(match("model", "eq", ["GPT-4o"])).toBe(true);
		expect(match("model", "neq", ["gpt-4o"])).toBe(false);
		expect(match("service", "in", ["a", "Checkout-Bot"])).toBe(true);
		expect(match("service", "not_in", ["a"])).toBe(true);
		expect(match("span_name", "contains", ["GPT"])).toBe(true);
		expect(match("environment", "eq", ["production"])).toBe(true);
	});

	it("treats eq/neq with several values as one-of, like the engine", () => {
		expect(match("model", "eq", ["gpt-4o-mini", "GPT-4o"])).toBe(true);
		expect(match("model", "neq", ["gpt-4o-mini", "gpt-4o"])).toBe(false);
		expect(match("model", "neq", ["gpt-4o-mini", "claude"])).toBe(true);
	});

	it("compares numbers for numeric operators", () => {
		expect(match("duration_ms", "gt", ["4000"])).toBe(true);
		expect(match("http_status", "gte", ["500"])).toBe(true);
		expect(match("cost", "lt", ["0.1"])).toBe(false);
		expect(match("gen_ai.request.temperature", "lte", ["0.7"])).toBe(true);
		expect(match("duration_ms", "gt", ["not a number"])).toBe(false);
	});

	it("treats a missing cost as not matching numeric comparisons", () => {
		expect(signalMatchesConditions({ ...signal, cost: null }, [{ field: "cost", op: "gt", values: ["0"] }], "production")).toBe(false);
	});

	it("handles exists and attributes", () => {
		expect(match("http.route", "exists")).toBe(true);
		expect(match("user.id", "exists")).toBe(false);
		expect(match("http.route", "eq", ["/chat"])).toBe(true);
	});

	it("requires every condition", () => {
		expect(
			signalMatchesConditions(
				signal,
				[
					{ field: "model", op: "eq", values: ["gpt-4o"] },
					{ field: "status", op: "eq", values: ["ok"] },
				],
				"production"
			)
		).toBe(false);
	});
});
