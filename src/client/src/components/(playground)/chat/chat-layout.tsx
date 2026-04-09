"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { ResizeablePanel } from "@/components/ui/resizeable-panel";
import ConversationList from "./conversation-list";
import ChatPanel from "./chat-panel";
import getMessage from "@/constants/messages";
import { toast } from "sonner";

interface Conversation {
	id: string;
	title: string;
	totalCost: number;
	totalMessages: number;
	updatedAt: string;
}

interface ChatLayoutProps {
	initialConversationId: string | null;
}

export default function ChatLayout({ initialConversationId }: ChatLayoutProps) {
	const m = getMessage();
	const router = useRouter();
	const [conversations, setConversations] = useState<Conversation[]>([]);
	const [activeId, setActiveId] = useState<string | null>(initialConversationId);
	const [hasConfig, setHasConfig] = useState(false);
	const [loadingConversations, setLoadingConversations] = useState(true);
	const [loadingConfig, setLoadingConfig] = useState(true);

	// Sync activeId with URL param changes
	useEffect(() => {
		setActiveId(initialConversationId);
	}, [initialConversationId]);

	const fetchConversations = useCallback(async () => {
		try {
			const res = await fetch("/api/chat/conversation");
			const result = await res.json();
			if (result.data) {
				setConversations(
					result.data.map((c: any) => ({
						id: c.id,
						title: c.title || m.CHAT_NEW_CONVERSATION,
						totalCost: Number(c.totalCost) || 0,
						totalMessages: Number(c.totalMessages) || 0,
						updatedAt: c.updatedAt,
					}))
				);
			}
		} catch {
			// Silently fail
		} finally {
			setLoadingConversations(false);
		}
	}, [m]);

	const fetchConfig = useCallback(async () => {
		try {
			const res = await fetch("/api/chat/config");
			const result = await res.json();
			setHasConfig(!!result.data?.provider);
		} catch {
			setHasConfig(false);
		} finally {
			setLoadingConfig(false);
		}
	}, []);

	useEffect(() => {
		fetchConversations();
		fetchConfig();
	}, [fetchConversations, fetchConfig]);

	const navigateTo = useCallback(
		(id: string | null) => {
			if (id) {
				router.push(`/chat?id=${id}`);
			} else {
				router.push("/chat");
			}
		},
		[router]
	);

	const handleNewConversation = useCallback(async (): Promise<string | null> => {
		try {
			const res = await fetch("/api/chat/conversation", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title: "" }),
			});
			const result = await res.json();

			if (result.data) {
				const newId = result.data;
				await fetchConversations();
				navigateTo(newId);
				return newId;
			}
		} catch {
			toast.error(m.CHAT_FAILED_TO_CREATE_CONVERSATION);
		}
		return null;
	}, [fetchConversations, navigateTo, m]);

	const handleDeleteConversation = useCallback(
		async (id: string) => {
			try {
				await fetch(`/api/chat/conversation/${id}`, { method: "DELETE" });
				setConversations((prev) => prev.filter((c) => c.id !== id));
				if (activeId === id) {
					navigateTo(null);
				}
			} catch {
				toast.error(m.CHAT_FAILED_TO_DELETE_CONVERSATION);
			}
		},
		[activeId, navigateTo, m]
	);

	const handleSelectConversation = useCallback(
		(id: string) => {
			navigateTo(id);
		},
		[navigateTo]
	);

	const handleNewChat = useCallback(() => {
		navigateTo(null);
	}, [navigateTo]);

	return (
		<Card className="flex h-full w-full overflow-hidden border-stone-200 dark:border-stone-800">
			{/* Conversation Sidebar */}
			<ResizeablePanel
				defaultWidth={280}
				minWidth={220}
				maxWidth={400}
				handlePosition="right"
				className="border-r border-stone-200 dark:border-stone-800"
			>
				<ConversationList
					conversations={conversations}
					activeId={activeId}
					onSelect={handleSelectConversation}
					onDelete={handleDeleteConversation}
					onNew={handleNewChat}
					isLoading={loadingConversations}
				/>
			</ResizeablePanel>

			{/* Chat Panel */}
			<div className="flex-1 min-w-0 bg-white dark:bg-stone-950">
				<ChatPanel
					conversationId={activeId}
					hasConfig={hasConfig && !loadingConfig}
					onNewConversation={handleNewConversation}
					onConversationUpdate={fetchConversations}
				/>
			</div>
		</Card>
	);
}
