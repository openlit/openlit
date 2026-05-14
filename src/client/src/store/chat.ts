"use client";
import { ChatStore } from "@/types/store/chat";
import { lens } from "@dhmk/zustand-lens";

export const chatStoreSlice: ChatStore = lens((setStore, getStore) => ({
	conversations: [],
	activeConversationId: null,
	messages: [],
	hasConfig: false,
	configInfo: null,
	isLoadingConversations: true,
	isLoadingConfig: true,
	isStreaming: false,

	setConversations: (conversations) =>
		setStore({ conversations }),

	setActiveConversationId: (id) =>
		setStore({ activeConversationId: id }),

	setMessages: (messages) =>
		setStore({ messages }),

	updateLastMessage: (content) => {
		const messages = [...getStore().messages];
		const lastIdx = messages.length - 1;
		if (lastIdx >= 0 && messages[lastIdx].role === "assistant") {
			messages[lastIdx] = { ...messages[lastIdx], content };
			setStore({ messages });
		}
	},

	updateLastMessageStep: (step) => {
		const messages = [...getStore().messages];
		const lastIdx = messages.length - 1;
		if (lastIdx < 0 || messages[lastIdx].role !== "assistant") return;

		const steps = [...(messages[lastIdx].steps || [])];
		const existingIndex = steps.findIndex((item) => item.label === step.label);
		if (existingIndex === -1) {
			steps.push(step);
		} else {
			steps[existingIndex] = { ...steps[existingIndex], ...step };
		}
		messages[lastIdx] = { ...messages[lastIdx], steps };
		setStore({ messages });
	},

	clearLastMessageSteps: () => {
		const messages = [...getStore().messages];
		const lastIdx = messages.length - 1;
		if (lastIdx >= 0 && messages[lastIdx].role === "assistant") {
			messages[lastIdx] = { ...messages[lastIdx], steps: [] };
			setStore({ messages });
		}
	},

	addMessage: (message) =>
		setStore({ messages: [...getStore().messages, message] }),

	setHasConfig: (hasConfig) =>
		setStore({ hasConfig }),

	setConfigInfo: (configInfo) =>
		setStore({ configInfo }),

	setIsLoadingConversations: (isLoadingConversations) =>
		setStore({ isLoadingConversations }),

	setIsLoadingConfig: (isLoadingConfig) =>
		setStore({ isLoadingConfig }),

	setIsStreaming: (isStreaming) =>
		setStore({ isStreaming }),

	updateConversation: (id, updates) => {
		const conversations = getStore().conversations.map((c) =>
			c.id === id ? { ...c, ...updates } : c
		);
		setStore({ conversations });
	},

	addConversation: (conversation) =>
		setStore({ conversations: [conversation, ...getStore().conversations] }),

	removeConversation: (id) =>
		setStore({
			conversations: getStore().conversations.filter((c) => c.id !== id),
		}),

	reset: () =>
		setStore({
			conversations: [],
			activeConversationId: null,
			messages: [],
			hasConfig: false,
			configInfo: null,
			isLoadingConversations: true,
			isLoadingConfig: true,
			isStreaming: false,
		}),
}));
