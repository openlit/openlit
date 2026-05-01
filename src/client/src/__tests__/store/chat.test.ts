import { create } from "zustand";
import { withLenses } from "@dhmk/zustand-lens";
import { chatStoreSlice } from "@/store/chat";
import { ChatConversation, ChatMessage } from "@/types/store/chat";

const createStore = () => create<any>()(withLenses({ chat: chatStoreSlice }));

const conversation = (
	id: string,
	overrides: Partial<ChatConversation> = {}
): ChatConversation => ({
	id,
	title: `Conversation ${id}`,
	totalCost: 0,
	totalMessages: 1,
	updatedAt: "2026-01-01T00:00:00.000Z",
	...overrides,
});

const message = (
	role: ChatMessage["role"],
	content: string
): ChatMessage => ({
	role,
	content,
});

describe("chatStoreSlice", () => {
	let store: ReturnType<typeof createStore>;

	beforeEach(() => {
		store = createStore();
	});

	it("starts with the expected initial state", () => {
		expect(store.getState().chat.conversations).toEqual([]);
		expect(store.getState().chat.activeConversationId).toBeNull();
		expect(store.getState().chat.messages).toEqual([]);
		expect(store.getState().chat.hasConfig).toBe(false);
		expect(store.getState().chat.configInfo).toBeNull();
		expect(store.getState().chat.isLoadingConversations).toBe(true);
		expect(store.getState().chat.isLoadingConfig).toBe(true);
		expect(store.getState().chat.isStreaming).toBe(false);
	});

	it("sets conversations, active id, messages, config, and loading flags", () => {
		const conversations = [conversation("c1")];
		const messages = [message("user", "show traces")];
		const configInfo = { providerName: "openai", modelName: "gpt-4o" };

		store.getState().chat.setConversations(conversations);
		store.getState().chat.setActiveConversationId("c1");
		store.getState().chat.setMessages(messages);
		store.getState().chat.setHasConfig(true);
		store.getState().chat.setConfigInfo(configInfo);
		store.getState().chat.setIsLoadingConversations(false);
		store.getState().chat.setIsLoadingConfig(false);
		store.getState().chat.setIsStreaming(true);

		expect(store.getState().chat.conversations).toEqual(conversations);
		expect(store.getState().chat.activeConversationId).toBe("c1");
		expect(store.getState().chat.messages).toEqual(messages);
		expect(store.getState().chat.hasConfig).toBe(true);
		expect(store.getState().chat.configInfo).toEqual(configInfo);
		expect(store.getState().chat.isLoadingConversations).toBe(false);
		expect(store.getState().chat.isLoadingConfig).toBe(false);
		expect(store.getState().chat.isStreaming).toBe(true);
	});

	it("adds messages and only updates the last assistant message", () => {
		store.getState().chat.addMessage(message("user", "question"));
		store.getState().chat.updateLastMessage("ignored");

		expect(store.getState().chat.messages).toEqual([
			message("user", "question"),
		]);

		store.getState().chat.addMessage(message("assistant", "partial"));
		store.getState().chat.updateLastMessage("complete");

		expect(store.getState().chat.messages).toEqual([
			message("user", "question"),
			message("assistant", "complete"),
		]);
	});

	it("adds, updates, and removes conversations", () => {
		store.getState().chat.setConversations([
			conversation("c1", { title: "Old" }),
		]);

		store.getState().chat.addConversation(conversation("c2"));
		store.getState().chat.updateConversation("c1", {
			title: "New",
			totalMessages: 3,
		});
		store.getState().chat.removeConversation("c2");

		expect(store.getState().chat.conversations).toEqual([
			conversation("c1", { title: "New", totalMessages: 3 }),
		]);
	});

	it("reset restores the initial state", () => {
		store.getState().chat.setConversations([conversation("c1")]);
		store.getState().chat.setActiveConversationId("c1");
		store.getState().chat.addMessage(message("assistant", "answer"));
		store.getState().chat.setHasConfig(true);
		store.getState().chat.setConfigInfo({ modelId: "model-1" });
		store.getState().chat.setIsLoadingConversations(false);
		store.getState().chat.setIsLoadingConfig(false);
		store.getState().chat.setIsStreaming(true);

		store.getState().chat.reset();

		expect(store.getState().chat).toMatchObject({
			conversations: [],
			activeConversationId: null,
			messages: [],
			hasConfig: false,
			configInfo: null,
			isLoadingConversations: true,
			isLoadingConfig: true,
			isStreaming: false,
		});
	});
});
