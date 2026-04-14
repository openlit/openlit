export interface ChatConversation {
	id: string;
	title: string;
	totalCost: number;
	totalMessages: number;
	totalPromptTokens?: number;
	totalCompletionTokens?: number;
	updatedAt: string;
}

export interface ChatMessage {
	id?: string;
	role: "user" | "assistant";
	content: string;
	promptTokens?: number;
	completionTokens?: number;
	cost?: number;
	queryRowsRead?: number;
	queryExecutionTimeMs?: number;
	createdAt?: string;
}

export interface ChatConfigInfo {
	providerName?: string;
	modelName?: string;
	modelId?: string;
	inputPricePerMToken?: number;
	outputPricePerMToken?: number;
	contextWindow?: number;
}

export type ChatStore = {
	conversations: ChatConversation[];
	activeConversationId: string | null;
	messages: ChatMessage[];
	hasConfig: boolean;
	configInfo: ChatConfigInfo | null;
	isLoadingConversations: boolean;
	isLoadingConfig: boolean;
	isStreaming: boolean;

	setConversations: (conversations: ChatConversation[]) => void;
	setActiveConversationId: (id: string | null) => void;
	setMessages: (messages: ChatMessage[]) => void;
	updateLastMessage: (content: string) => void;
	addMessage: (message: ChatMessage) => void;
	setHasConfig: (hasConfig: boolean) => void;
	setConfigInfo: (info: ChatConfigInfo | null) => void;
	setIsLoadingConversations: (loading: boolean) => void;
	setIsLoadingConfig: (loading: boolean) => void;
	setIsStreaming: (streaming: boolean) => void;

	// Update a single conversation in the list (for title/token updates)
	updateConversation: (id: string, updates: Partial<ChatConversation>) => void;
	// Add a conversation to the top of the list
	addConversation: (conversation: ChatConversation) => void;
	// Remove a conversation from the list
	removeConversation: (id: string) => void;

	reset: () => void;
};
