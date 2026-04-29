"use client";

import { useRef, useEffect, useCallback } from "react";
import MessageBubble from "./message-bubble";

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

interface MessageListProps {
	messages: Message[];
	isStreaming: boolean;
	onExecuteQuery: (
		query: string,
		messageId?: string
	) => Promise<{ data?: any[]; stats?: any; err?: string }>;
}

export default function MessageList({
	messages,
	isStreaming,
	onExecuteQuery,
}: MessageListProps) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const isNearBottomRef = useRef(true);

	const checkNearBottom = useCallback(() => {
		const el = scrollRef.current;
		if (!el) return;
		const threshold = 100;
		isNearBottomRef.current =
			el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
	}, []);

	useEffect(() => {
		if (isNearBottomRef.current) {
			const el = scrollRef.current;
			if (el) {
				el.scrollTop = el.scrollHeight;
			}
		}
	}, [messages, isStreaming]);

	return (
		<div
			ref={scrollRef}
			onScroll={checkNearBottom}
			className="flex-1 overflow-y-auto"
		>
			<div className="max-w-4xl mx-auto px-4 py-6 space-y-1">
				{messages.map((msg, i) => {
					const isLastAssistant =
						isStreaming &&
						msg.role === "assistant" &&
						i === messages.length - 1;

					return (
						<MessageBubble
							key={msg.id || `msg-${i}`}
							role={msg.role}
							content={msg.content}
							promptTokens={msg.promptTokens}
							completionTokens={msg.completionTokens}
							cost={msg.cost}
							queryRowsRead={msg.queryRowsRead}
							queryExecutionTimeMs={msg.queryExecutionTimeMs}
							createdAt={msg.createdAt}
							isStreaming={isLastAssistant}
							onExecuteQuery={onExecuteQuery}
							messageId={msg.id}
						/>
					);
				})}
			</div>
		</div>
	);
}
