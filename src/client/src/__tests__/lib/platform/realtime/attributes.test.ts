import { isRealtimeAttributeField, isRealtimeMapKey } from "@/lib/platform/realtime/attributes";

describe("realtime attribute allowlist", () => {
	const previous = process.env.OPENLIT_SIGNAL_ATTRIBUTES;

	afterEach(() => {
		if (previous === undefined) delete process.env.OPENLIT_SIGNAL_ATTRIBUTES;
		else process.env.OPENLIT_SIGNAL_ATTRIBUTES = previous;
	});

	it("accepts operational attributes and extra keys, and blocks prompt text", () => {
		process.env.OPENLIT_SIGNAL_ATTRIBUTES = "app.tier, gen_ai.prompt, not a key";
		expect(isRealtimeAttributeField("user.id")).toBe(true);
		expect(isRealtimeAttributeField("gen_ai.tool.name")).toBe(true);
		expect(isRealtimeAttributeField("app.tier")).toBe(true);
		expect(isRealtimeAttributeField("gen_ai.prompt")).toBe(false);
		expect(isRealtimeAttributeField("gen_ai.input.messages")).toBe(false);
		expect(isRealtimeAttributeField("not a key")).toBe(false);
		expect(isRealtimeAttributeField("model")).toBe(false);
		expect(isRealtimeMapKey("traceId")).toBe(true);
		expect(isRealtimeMapKey("gen_ai.prompt")).toBe(false);
	});
});