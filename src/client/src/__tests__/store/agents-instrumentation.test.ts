import { create } from "zustand";
import { withLenses } from "@dhmk/zustand-lens";
import {
	agentsInstrumentationStoreSlice,
	OPTIMISTIC_INTENT_TTL_MS,
} from "@/store/agents-instrumentation";

const createStore = () =>
	create<any>()(
		withLenses({ agentsInstrumentation: agentsInstrumentationStoreSlice })
	);

describe("agentsInstrumentationStoreSlice", () => {
	let store: ReturnType<typeof createStore>;
	let nowSpy: jest.SpyInstance<number, []>;

	beforeEach(() => {
		store = createStore();
		nowSpy = jest.spyOn(Date, "now").mockReturnValue(1000);
	});

	afterEach(() => {
		nowSpy.mockRestore();
	});

	it("sets optimistic intents with expiry metadata", () => {
		store
			.getState()
			.agentsInstrumentation.setIntent("agent-1", "llm", "enabling");

		expect(store.getState().agentsInstrumentation.intents).toEqual({
			"agent-1": {
				llm: {
					feature: "llm",
					direction: "enabling",
					queuedAt: 1000,
					expiresAt: 1000 + OPTIMISTIC_INTENT_TTL_MS,
				},
			},
		});
	});

	it("tracks independent feature intents per agent", () => {
		store
			.getState()
			.agentsInstrumentation.setIntent("agent-1", "llm", "enabling");
		store
			.getState()
			.agentsInstrumentation.setIntent("agent-1", "agent", "disabling");

		expect(
			Object.keys(store.getState().agentsInstrumentation.intents["agent-1"])
		).toEqual(["llm", "agent"]);
	});

	it("clears individual intents and removes empty agent entries", () => {
		store
			.getState()
			.agentsInstrumentation.setIntent("agent-1", "llm", "enabling");
		store
			.getState()
			.agentsInstrumentation.setIntent("agent-1", "agent", "disabling");

		store.getState().agentsInstrumentation.clearIntent("agent-1", "llm");
		expect(store.getState().agentsInstrumentation.intents["agent-1"]).toEqual({
			agent: expect.objectContaining({ feature: "agent" }),
		});

		store.getState().agentsInstrumentation.clearIntent("agent-1", "agent");
		expect(store.getState().agentsInstrumentation.intents).toEqual({});
	});

	it("ignores clearing missing intents", () => {
		store.getState().agentsInstrumentation.clearIntent("missing", "llm");
		expect(store.getState().agentsInstrumentation.intents).toEqual({});
	});

	it("prunes expired intents and keeps fresh intents", () => {
		nowSpy.mockReturnValue(1000);
		store
			.getState()
			.agentsInstrumentation.setIntent("agent-1", "llm", "enabling");

		nowSpy.mockReturnValue(2000);
		store
			.getState()
			.agentsInstrumentation.setIntent("agent-2", "agent", "disabling");

		nowSpy.mockReturnValue(1001 + OPTIMISTIC_INTENT_TTL_MS);
		store.getState().agentsInstrumentation.pruneExpired();

		expect(store.getState().agentsInstrumentation.intents).toEqual({
			"agent-2": {
				agent: expect.objectContaining({ feature: "agent" }),
			},
		});
	});

	it("keeps state unchanged when nothing is expired", () => {
		store
			.getState()
			.agentsInstrumentation.setIntent("agent-1", "llm", "enabling");
		const before = store.getState().agentsInstrumentation.intents;

		nowSpy.mockReturnValue(1000 + OPTIMISTIC_INTENT_TTL_MS - 1);
		store.getState().agentsInstrumentation.pruneExpired();

		expect(store.getState().agentsInstrumentation.intents).toBe(before);
	});
});
