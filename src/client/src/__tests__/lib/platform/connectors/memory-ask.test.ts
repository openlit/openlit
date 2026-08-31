import { buildMemoryAskPrompt, memoryAskSelectedSummary } from "@/lib/platform/connectors/memory/ask";
import {
	MEMORY_ASK_FALLBACK_PROMPT,
	MEMORY_ASK_OTTER_PROMPT,
	MEMORY_ASK_SELECTED_PROMPT,
	MEMORY_ASK_TOOLS_PROMPT,
} from "@/constants/messages/en";

describe("buildMemoryAskPrompt", () => {
	it("stays compact and only passes filters the connector declares", () => {
		const prompt = buildMemoryAskPrompt("What does Ada prefer?", {
			connectorId: "memory:abc",
			userId: "ada",
			sessionId: "run-9",
			agentId: "bot",
			filterKeys: ["userId", "sessionId", "agentId"],
			canList: true,
			canSearch: true,
		});
		expect(prompt).toContain(MEMORY_ASK_TOOLS_PROMPT);
		expect(prompt).toContain(MEMORY_ASK_OTTER_PROMPT);
		expect(prompt).toContain("connector_id=memory:abc");
		expect(prompt).toContain("user_id=ada");
		expect(prompt).toContain("session_id=run-9");
		expect(prompt).toContain("agent_id=bot");
		expect(prompt).toContain("What does Ada prefer?");
		expect(prompt.split("\n").length).toBeLessThan(10);
	});

	it("omits user_id for store-scoped connectors like Claude", () => {
		const prompt = buildMemoryAskPrompt("what is remembered?", {
			connectorId: "memory:claude",
			userId: "alex",
			sessionId: "memstore_1",
			filterKeys: ["sessionId"],
			canList: true,
			canSearch: true,
		});
		expect(prompt).toContain("session_id=memstore_1");
		expect(prompt).not.toContain("user_id=");
		expect(prompt).toContain("what is remembered?");
	});

	it("includes a short selected-memory hint only", () => {
		const prompt = buildMemoryAskPrompt("Summarize this", {
			memoryId: "mem-1",
			memoryContent: "User visited New York",
			canList: true,
			filterKeys: ["sessionId"],
		});
		expect(prompt).toContain(
			MEMORY_ASK_SELECTED_PROMPT("mem-1", "User visited New York")
		);
		expect(
			memoryAskSelectedSummary({
				memoryId: "mem-1",
				memoryContent: "User visited New York",
			})
		).toBe("User visited New York");
	});

	it("falls back when the connector has no list/search API", () => {
		const prompt = buildMemoryAskPrompt("who are my users?", {
			connectorId: "memory:1",
			filterKeys: ["userId"],
			userId: "alex",
			canList: false,
			canSearch: false,
		});
		expect(prompt).toContain(MEMORY_ASK_FALLBACK_PROMPT);
		expect(prompt).not.toContain(MEMORY_ASK_TOOLS_PROMPT);
		expect(prompt).toContain("user_id=alex");
	});
});
