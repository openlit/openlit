import { getBuiltinRealtimeRules } from "@/lib/platform/realtime/builtin-rules";
import { getActiveRealtimeRules, isWithinRuleScope } from "@/lib/platform/realtime/rules";

describe("built-in realtime rules", () => {
	const env = process.env;
	beforeEach(() => {
		process.env = { ...env };
	});
	afterAll(() => {
		process.env = env;
	});

	it("ships the fixed four-rule pack with global scope", () => {
		const rules = getBuiltinRealtimeRules();
		expect(rules.map((r) => r.id)).toEqual([
			"builtin.error_rate",
			"builtin.p95_latency",
			"builtin.token_spike",
			"builtin.cost_spike",
		]);
		for (const rule of rules) {
			expect(rule.scope).toEqual({});
			expect(rule.mode).toBe("window");
			expect(rule.name).toBeTruthy();
		}
	});

	it("reads thresholds from operator configuration", () => {
		process.env.OPENLIT_REALTIME_ERROR_RATE = "0.5";
		process.env.OPENLIT_REALTIME_WINDOW_SEC = "99999";
		const rule = getBuiltinRealtimeRules()[0];
		expect(rule.threshold).toBe(0.5);
		expect(rule.windowSec).toBe(3600);
	});

	it("can be disabled", async () => {
		process.env.OPENLIT_REALTIME_BUILTIN_RULES = "false";
		expect(getBuiltinRealtimeRules()).toEqual([]);
		expect(await getActiveRealtimeRules()).toEqual([]);
	});

	it("checks rule scope against a tenant", () => {
		const rule = { ...getBuiltinRealtimeRules()[0], scope: { organisationId: "o1", environment: "prod" } };
		expect(isWithinRuleScope(rule, { organisationId: "o1", projectId: "p", environment: "prod" })).toBe(true);
		expect(isWithinRuleScope(rule, { organisationId: "o2", projectId: "p", environment: "prod" })).toBe(false);
		expect(isWithinRuleScope(rule, { organisationId: "o1", projectId: "p", environment: "dev" })).toBe(false);
	});
});
