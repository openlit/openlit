import { buildMemoryAskPrompt } from "@/lib/platform/connectors/memory/ask";
import { MEMORY_ASK_OTTER_PROMPT } from "@/constants/messages/en";

describe("buildMemoryAskPrompt", () => {
	it("keeps the question on the Memory page and passes current filters", () => {
		const prompt = buildMemoryAskPrompt("What does Ada prefer?", {
			connectorId: "memory:abc",
			userId: "ada",
			sessionId: "run-9",
		});
		expect(prompt).toContain(MEMORY_ASK_OTTER_PROMPT);
		expect(prompt).toContain("connector_id=memory:abc");
		expect(prompt).toContain("user_id=ada");
		expect(prompt).toContain("session_id=run-9");
		expect(prompt).toContain("What does Ada prefer?");
		expect(prompt).not.toContain("/chat");
	});
});
