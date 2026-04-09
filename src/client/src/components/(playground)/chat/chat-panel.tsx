"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import getMessage from "@/constants/messages";
import MessageList from "./message-list";
import MessageInput from "./message-input";
import ChatEmptyState from "./chat-empty-state";

interface Message {
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

interface ChatPanelProps {
	conversationId: string | null;
	hasConfig: boolean;
	onNewConversation: () => Promise<string | null>;
	onConversationUpdate: () => void;
}

export default function ChatPanel({
	conversationId,
	hasConfig,
	onNewConversation,
	onConversationUpdate,
}: ChatPanelProps) {
	const [messages, setMessages] = useState<Message[]>([]);
	const [input, setInput] = useState("");
	const [isStreaming, setIsStreaming] = useState(false);
	const abortControllerRef = useRef<AbortController | null>(null);
	// When true, skip the next useEffect message reload because we're managing state locally
	const skipNextLoadRef = useRef(false);

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
				if (res.data?.messages && res.data.messages.length > 0) {
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
				// If no messages yet (fresh conversation), keep current local messages intact
			})
			.catch(() => {});
	}, [conversationId]);

	const sendMessage = useCallback(
		async (text?: string) => {
			const content = text || input.trim();
			if (!content || isStreaming) return;

			let currentConvId = conversationId;

			// Create a new conversation if none is selected
			if (!currentConvId) {
				// Tell the effect to skip the next load since we'll manage messages locally
				skipNextLoadRef.current = true;
				currentConvId = await onNewConversation();
				if (!currentConvId) {
					skipNextLoadRef.current = false;
					return;
				}
			}

			// Add user message optimistically
			setMessages((prev) => [
				...prev,
				{
					role: "user",
					content,
					createdAt: new Date().toISOString(),
				},
			]);
			setInput("");
			setIsStreaming(true);

			// Add empty assistant message for streaming
			setMessages((prev) => [
				...prev,
				{
					role: "assistant",
					content: "",
					createdAt: new Date().toISOString(),
				},
			]);

			try {
				const controller = new AbortController();
				abortControllerRef.current = controller;

				const res = await fetch("/api/chat/message", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						conversationId: currentConvId,
						content,
					}),
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

					setMessages((prev) => {
						const updated = [...prev];
						const lastIdx = updated.length - 1;
						if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
							updated[lastIdx] = {
								...updated[lastIdx],
								content: fullText,
							};
						}
						return updated;
					});
				}

				onConversationUpdate();
			} catch (e: any) {
				if (e.name === "AbortError") {
					setMessages((prev) => {
						const updated = [...prev];
						const lastIdx = updated.length - 1;
						if (
							lastIdx >= 0 &&
							updated[lastIdx].role === "assistant" &&
							!updated[lastIdx].content
						) {
							updated.pop();
						}
						return updated;
					});
				} else {
					setMessages((prev) => {
						const updated = [...prev];
						const lastIdx = updated.length - 1;
						if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
							updated[lastIdx] = {
								...updated[lastIdx],
								content: `**${getMessage().CHAT_ERROR_PREFIX}** ${e.message || getMessage().CHAT_SOMETHING_WENT_WRONG}`,
							};
						}
						return updated;
					});
				}
			} finally {
				setIsStreaming(false);
				abortControllerRef.current = null;
			}
		},
		[conversationId, input, isStreaming, onNewConversation, onConversationUpdate]
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
					return {
						err:
							typeof result.err === "string"
								? result.err
								: JSON.stringify(result.err),
					};
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
				value={input}
				onChange={setInput}
				onSubmit={() => sendMessage()}
				isLoading={isStreaming}
				disabled={!hasConfig}
			/>
		</div>
	);
}
