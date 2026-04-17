"use client";

import { useCallback, useEffect, useRef } from "react";
import getMessage from "@/constants/messages";
import { useRootStore } from "@/store";
import {
	getChatMessages,
	getChatIsStreaming,
	getChatActions,
} from "@/selectors/chat";
import { ChatConfigInfo } from "./message-input";
import MessageList from "./message-list";
import MessageInput from "./message-input";
import ChatEmptyState from "./chat-empty-state";

interface ChatPanelProps {
	conversationId: string | null;
	hasConfig: boolean;
	configInfo?: ChatConfigInfo | null;
	onNewConversation: () => Promise<string | null>;
}

export default function ChatPanel({
	conversationId,
	hasConfig,
	configInfo,
	onNewConversation,
}: ChatPanelProps) {
	const messages = useRootStore(getChatMessages);
	const isStreaming = useRootStore(getChatIsStreaming);
	const {
		setMessages,
		addMessage,
		updateLastMessage,
		setIsStreaming,
		updateConversation,
	} = useRootStore(getChatActions);

	const inputRef = useRef("");
	const abortControllerRef = useRef<AbortController | null>(null);
	const skipNextLoadRef = useRef(false);

	// Input state — ref avoids re-renders, state keeps textarea controlled
	const [inputValue, setInputValue] = useInputState(inputRef);

	// Load messages when conversation changes
	useEffect(() => {
		if (skipNextLoadRef.current) {
			skipNextLoadRef.current = false;
			return;
		}

		if (!conversationId) {
			setMessages([]);
			return;
		}

		fetch(`/api/chat/conversation/${conversationId}`)
			.then((res) => res.json())
			.then((res) => {
				if (res.data?.messages?.length > 0) {
					setMessages(
						res.data.messages.map((m: any) => ({
							id: m.id,
							role: m.role,
							content: m.content,
							promptTokens: Number(m.promptTokens) || 0,
							completionTokens: Number(m.completionTokens) || 0,
							cost: Number(m.cost) || 0,
							queryRowsRead: Number(m.queryRowsRead) || 0,
							queryExecutionTimeMs: Number(m.queryExecutionTimeMs) || 0,
							createdAt: m.createdAt,
						}))
					);
				}
				// Update sidebar with this conversation's latest data
				if (res.data?.conversation) {
					const conv = res.data.conversation;
					updateConversation(conversationId, {
						title: conv.title,
						totalCost: Number(conv.totalCost) || 0,
						totalMessages: Number(conv.totalMessages) || 0,
						updatedAt: conv.updatedAt,
					});
				}
			})
			.catch(() => {});
	}, [conversationId, setMessages, updateConversation]);

	/**
	 * Fetch a single conversation and update the store (sidebar + messages).
	 * Called after streaming completes to pick up stats, title, and query results.
	 */
	const refreshConversation = useCallback(
		(convId: string) => {
			fetch(`/api/chat/conversation/${convId}`)
				.then((res) => res.json())
				.then((res) => {
					if (res.data?.conversation) {
						const conv = res.data.conversation;
						const updates: any = {
							totalCost: Number(conv.totalCost) || 0,
							totalMessages: Number(conv.totalMessages) || 0,
							updatedAt: conv.updatedAt,
						};
						// Only update title if it's non-empty (title generation may still be pending)
						if (conv.title) {
							updates.title = conv.title;
						}
						updateConversation(convId, updates);
					}
					if (res.data?.messages?.length > 0) {
						setMessages(
							res.data.messages.map((m: any) => ({
								id: m.id,
								role: m.role,
								content: m.content,
								promptTokens: Number(m.promptTokens) || 0,
								completionTokens: Number(m.completionTokens) || 0,
								cost: Number(m.cost) || 0,
								queryRowsRead: Number(m.queryRowsRead) || 0,
								queryExecutionTimeMs: Number(m.queryExecutionTimeMs) || 0,
								createdAt: m.createdAt,
							}))
						);
					}
				})
				.catch(() => {});
		},
		[setMessages, updateConversation]
	);

	const sendMessage = useCallback(
		async (text?: string) => {
			const content = text || inputRef.current.trim();
			if (!content || isStreaming) return;

			let currentConvId = conversationId;

			if (!currentConvId) {
				skipNextLoadRef.current = true;
				currentConvId = await onNewConversation();
				if (!currentConvId) {
					skipNextLoadRef.current = false;
					return;
				}
			}

			// Add user message optimistically
			addMessage({ role: "user", content, createdAt: new Date().toISOString() });
			setInputValue("");
			setIsStreaming(true);

			// Add empty assistant message for streaming
			addMessage({ role: "assistant", content: "", createdAt: new Date().toISOString() });

			try {
				const controller = new AbortController();
				abortControllerRef.current = controller;

				const res = await fetch("/api/chat/message", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ conversationId: currentConvId, content }),
					signal: controller.signal,
				});

				if (!res.ok) {
					const errText = await res.text();
					throw new Error(errText || getMessage().CHAT_FAILED_TO_GET_RESPONSE);
				}

				const reader = res.body?.getReader();
				if (!reader) throw new Error(getMessage().CHAT_NO_RESPONSE_STREAM);

				const decoder = new TextDecoder();
				let fullText = "";

				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					const chunk = decoder.decode(value, { stream: true });
					fullText += chunk;
					updateLastMessage(fullText);
				}

				// After stream completes, refresh this conversation from server.
				// Two refreshes: first for message stats/query results, second for title
				// (title generation is a separate LLM call that takes longer).
				if (currentConvId && !fullText.startsWith("**Error:**")) {
					// 1st refresh: message stats, cost, query results
					setTimeout(() => refreshConversation(currentConvId!), 2000);
					// 2nd refresh: title (generateText takes 3-5s)
					setTimeout(() => {
						fetch(`/api/chat/conversation/${currentConvId}`)
							.then((r) => r.json())
							.then((res) => {
								if (res.data?.conversation?.title) {
									updateConversation(currentConvId!, {
										title: res.data.conversation.title,
									});
								}
							})
							.catch(() => {});
					}, 6000);
				}
			} catch (e: any) {
				if (e.name === "AbortError") {
					// Remove empty assistant message on cancel
					setMessages(messages.filter((m, i) => !(i === messages.length - 1 && m.role === "assistant" && !m.content)));
				} else {
					updateLastMessage(`**${getMessage().CHAT_ERROR_PREFIX}** ${e.message || getMessage().CHAT_SOMETHING_WENT_WRONG}`);
				}
			} finally {
				setIsStreaming(false);
				abortControllerRef.current = null;
			}
		},
		[conversationId, isStreaming, messages, onNewConversation, addMessage, updateLastMessage, setMessages, setIsStreaming, setInputValue, refreshConversation]
	);

	const handleExecuteQuery = useCallback(
		async (query: string, messageId?: string) => {
			try {
				const res = await fetch("/api/chat/message/execute", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ messageId, query }),
				});
				const result = await res.json();
				if (!res.ok || result.err) {
					return { err: typeof result.err === "string" ? result.err : JSON.stringify(result.err) };
				}
				return { data: result.data, stats: result.stats };
			} catch (e: any) {
				return { err: e.message || getMessage().CHAT_QUERY_EXECUTION_FAILED };
			}
		},
		[]
	);

	const showEmptyState = !conversationId && messages.length === 0 && !isStreaming;

	return (
		<div className="flex flex-col h-full">
			{showEmptyState ? (
				<ChatEmptyState
					onSendQuestion={(q) => sendMessage(q)}
					hasConfig={hasConfig}
				/>
			) : (
				<MessageList
					messages={messages}
					isStreaming={isStreaming}
					onExecuteQuery={handleExecuteQuery}
				/>
			)}
			<MessageInput
				value={inputValue}
				onChange={setInputValue}
				onSubmit={() => sendMessage()}
				isLoading={isStreaming}
				disabled={!hasConfig}
				configInfo={configInfo}
			/>
		</div>
	);
}

/**
 * Custom hook to manage input value via ref (avoids re-renders)
 * but still provides a state value for the controlled textarea.
 */
function useInputState(ref: React.MutableRefObject<string>): [string, (val: string) => void] {
	const [value, setValue] = __useState(ref.current);

	const setInputValue = useCallback(
		(val: string) => {
			ref.current = val;
			setValue(val);
		},
		[ref]
	);

	return [value, setInputValue];
}

// Import useState with alias to avoid conflict
import { useState as __useState } from "react";
