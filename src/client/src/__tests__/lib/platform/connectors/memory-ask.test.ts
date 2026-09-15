import {
	buildMemoryAskPrompt,
	memoryAskExcerpt,
	memoryAskSelectedSummary,
} from "@/lib/platform/connectors/memory/ask";
import {
	MEMORY_ASK_FALLBACK_PROMPT,
	MEMORY_ASK_OTTER_PROMPT,
	MEMORY_ASK_SELECTED_PROMPT,
	MEMORY_ASK_TOOLS_PROMPT,
} from "@/constants/messages/en";

describe("memoryAskExcerpt", () => {
	it("returns an empty string for missing or whitespace-only values", () => {
		expect(memoryAskExcerpt(undefined)).toBe("");
		expect(memoryAskExcerpt("   \n  ")).toBe("");
	});

	it("truncates text longer than the max length with an ellipsis", () => {
		const long = "a".repeat(150);
		const excerpt = memoryAskExcerpt(long);
		expect(excerpt).toHaveLength(121);
		expect(excerpt.endsWith("…")).toBe(true);
	});
});

describe("memoryAskSelectedSummary", () => {
	it("falls back to the memory id when there is no content to summarize", () => {
		expect(memoryAskSelectedSummary({ memoryId: "mem-1" })).toBe("mem-1");
	});

	it("returns undefined when there is neither content nor a memory id", () => {
		expect(memoryAskSelectedSummary({})).toBeUndefined();
		expect(memoryAskSelectedSummary()).toBeUndefined();
	});
});

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

	it("allows every filter key when the connector declares no filterKeys", () => {
		const prompt = buildMemoryAskPrompt("who talked to Ada?", {
			connectorId: "memory:1",
			userId: "ada",
			agentId: "bot",
			sessionId: "run-1",
			canList: true,
			canSearch: true,
		});
		expect(prompt).toContain("user_id=ada");
		expect(prompt).toContain("agent_id=bot");
		expect(prompt).toContain("session_id=run-1");
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
