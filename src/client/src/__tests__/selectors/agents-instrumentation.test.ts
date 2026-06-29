import {
	getAgentIntents,
	getClearAgentIntent,
	getPruneExpiredAgentIntents,
	getSetAgentIntent,
	useAgentIntent,
} from "@/selectors/agents-instrumentation";
import { useRootStore } from "@/store";

jest.mock("@/store", () => ({
	useRootStore: jest.fn(),
}));

const mockUseRootStore = jest.mocked(useRootStore);

describe("agent instrumentation selectors", () => {
	const state = {
		agentsInstrumentation: {
			intents: {
				"agent-1": {
					llm: {
						feature: "llm",
						direction: "enabling",
						queuedAt: 1000,
						expiresAt: 2000,
					},
				},
			},
			setIntent: jest.fn(),
			clearIntent: jest.fn(),
			pruneExpired: jest.fn(),
		},
	} as any;

	beforeEach(() => {
		jest.clearAllMocks();
		mockUseRootStore.mockImplementation((selector: any) => selector(state));
	});

	it("returns selector values and action references", () => {
		expect(getAgentIntents(state)).toBe(state.agentsInstrumentation.intents);
		expect(getSetAgentIntent(state)).toBe(state.agentsInstrumentation.setIntent);
		expect(getClearAgentIntent(state)).toBe(
			state.agentsInstrumentation.clearIntent
		);
		expect(getPruneExpiredAgentIntents(state)).toBe(
			state.agentsInstrumentation.pruneExpired
		);
	});

	it("returns the matching optimistic intent from the hook selector", () => {
		expect(useAgentIntent("agent-1", "llm")).toBe(
			state.agentsInstrumentation.intents["agent-1"].llm
		);
		expect(useAgentIntent("agent-1", "agent")).toBeNull();
		expect(useAgentIntent("missing", "llm")).toBeNull();
	});
});
