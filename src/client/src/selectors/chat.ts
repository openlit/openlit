import { RootStore } from "@/types/store/root";

export const getChatConversations = (state: RootStore) => state.chat.conversations;
export const getChatActiveId = (state: RootStore) => state.chat.activeConversationId;
export const getChatMessages = (state: RootStore) => state.chat.messages;
export const getChatHasConfig = (state: RootStore) => state.chat.hasConfig;
export const getChatConfigInfo = (state: RootStore) => state.chat.configInfo;
export const getChatIsLoadingConversations = (state: RootStore) => state.chat.isLoadingConversations;
export const getChatIsLoadingConfig = (state: RootStore) => state.chat.isLoadingConfig;
export const getChatIsStreaming = (state: RootStore) => state.chat.isStreaming;

export const getChatActions = (state: RootStore) => ({
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
