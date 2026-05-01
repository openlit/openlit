import {
	getChatActions,
	getChatActiveId,
	getChatConfigInfo,
	getChatConversations,
	getChatHasConfig,
	getChatIsLoadingConfig,
	getChatIsLoadingConversations,
	getChatIsStreaming,
	getChatMessages,
} from "@/selectors/chat";

const makeState = (overrides: Record<string, any> = {}) =>
	({
		chat: {
			conversations: [{ id: "c1", title: "Conversation" }],
			activeConversationId: "c1",
			messages: [{ role: "user", content: "hello" }],
			hasConfig: true,
			configInfo: { providerName: "openai", modelName: "gpt-4o" },
			isLoadingConversations: false,
			isLoadingConfig: false,
			isStreaming: true,
			setConversations: jest.fn(),
			setActiveConversationId: jest.fn(),
			setMessages: jest.fn(),
			updateLastMessage: jest.fn(),
			addMessage: jest.fn(),
			setHasConfig: jest.fn(),
			setConfigInfo: jest.fn(),
			setIsLoadingConversations: jest.fn(),
			setIsLoadingConfig: jest.fn(),
			setIsStreaming: jest.fn(),
			updateConversation: jest.fn(),
			addConversation: jest.fn(),
			removeConversation: jest.fn(),
			reset: jest.fn(),
			...overrides,
		},
	} as any);

describe("chat selectors", () => {
	it("returns chat state values", () => {
		const state = makeState();

		expect(getChatConversations(state)).toBe(state.chat.conversations);
		expect(getChatActiveId(state)).toBe("c1");
		expect(getChatMessages(state)).toBe(state.chat.messages);
		expect(getChatHasConfig(state)).toBe(true);
		expect(getChatConfigInfo(state)).toEqual({
			providerName: "openai",
			modelName: "gpt-4o",
		});
		expect(getChatIsLoadingConversations(state)).toBe(false);
		expect(getChatIsLoadingConfig(state)).toBe(false);
		expect(getChatIsStreaming(state)).toBe(true);
	});

	it("returns chat action references", () => {
		const state = makeState();

		expect(getChatActions(state)).toEqual({
			setConversations: state.chat.setConversations,
			setActiveConversationId: state.chat.setActiveConversationId,
			setMessages: state.chat.setMessages,
			updateLastMessage: state.chat.updateLastMessage,
			addMessage: state.chat.addMessage,
			setHasConfig: state.chat.setHasConfig,
			setConfigInfo: state.chat.setConfigInfo,
			setIsLoadingConversations: state.chat.setIsLoadingConversations,
			setIsLoadingConfig: state.chat.setIsLoadingConfig,
			setIsStreaming: state.chat.setIsStreaming,
			updateConversation: state.chat.updateConversation,
			addConversation: state.chat.addConversation,
			removeConversation: state.chat.removeConversation,
			reset: state.chat.reset,
		});
	});
});
