import {
	OPENLIT_CHAT_CONFIG_TABLE,
	OPENLIT_CHAT_CONVERSATION_TABLE,
	OPENLIT_CHAT_MESSAGE_TABLE,
} from "@/lib/platform/chat/table-details";

describe("chat table details", () => {
	it("exports chat table names", () => {
		expect(OPENLIT_CHAT_CONFIG_TABLE).toBe("openlit_chat_config");
		expect(OPENLIT_CHAT_CONVERSATION_TABLE).toBe("openlit_chat_conversation");
		expect(OPENLIT_CHAT_MESSAGE_TABLE).toBe("openlit_chat_message");
	});
});
