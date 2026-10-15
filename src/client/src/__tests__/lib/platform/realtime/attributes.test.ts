import { isRealtimeAttributeField, isRealtimeMapKey } from "@/lib/platform/realtime/attributes";

describe("realtime attribute fields", () => {
	const previous = process.env.OPENLIT_SIGNAL_ATTRIBUTES;

	afterEach(() => {
		if (previous === undefined) delete process.env.OPENLIT_SIGNAL_ATTRIBUTES;
		else process.env.OPENLIT_SIGNAL_ATTRIBUTES = previous;
	});

	it("accepts any safe attribute key without configuration, and blocks prompt text", () => {
		delete process.env.OPENLIT_SIGNAL_ATTRIBUTES;
		expect(isRealtimeAttributeField("gen_ai.tool.name")).toBe(true);
		expect(isRealtimeAttributeField("app.tier")).toBe(true);
		expect(isRealtimeAttributeField("gen_ai.agent.name")).toBe(true);
		expect(isRealtimeAttributeField("k8s.namespace.name")).toBe(true);
		expect(isRealtimeAttributeField("user.id")).toBe(false);
		expect(isRealtimeAttributeField("user.email")).toBe(false);
		expect(isRealtimeAttributeField("client.ip")).toBe(false);
		expect(isRealtimeAttributeField("gen_ai.prompt")).toBe(false);
		expect(isRealtimeAttributeField("gen_ai.input.messages")).toBe(false);
		expect(isRealtimeAttributeField("db.password")).toBe(false);
		expect(isRealtimeAttributeField("not a key")).toBe(false);
		expect(isRealtimeAttributeField("model")).toBe(false);
		expect(isRealtimeAttributeField("http_status")).toBe(false);
		process.env.OPENLIT_SIGNAL_ATTRIBUTES = "gen_ai.prompt";
		expect(isRealtimeAttributeField("gen_ai.prompt")).toBe(false);
		expect(isRealtimeMapKey("traceId")).toBe(true);
		expect(isRealtimeMapKey("gen_ai.prompt")).toBe(false);
	});

	it("only allows personal identifiers when explicitly listed", () => {
		delete process.env.OPENLIT_SIGNAL_ATTRIBUTES;
		for (const key of ["user.id", "enduser.id", "session.id", "conversation.id", "gen_ai.conversation.id", "url.path", "server.address"]) {
			expect(isRealtimeAttributeField(key)).toBe(false);
		}
		process.env.OPENLIT_SIGNAL_ATTRIBUTES = "user.id,url.path";
		expect(isRealtimeAttributeField("user.id")).toBe(true);
		expect(isRealtimeAttributeField("url.path")).toBe(true);
		expect(isRealtimeAttributeField("session.id")).toBe(false);
	});
});
