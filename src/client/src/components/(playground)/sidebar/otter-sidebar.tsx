"use client";

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";
import { BarChart3, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import ConversationList from "@/components/(playground)/chat/conversation-list";
import getMessage from "@/constants/messages";
import { getChatActions, getChatActiveId, getChatConversations, getChatIsLoadingConversations } from "@/selectors/chat";
import { useRootStore } from "@/store";

export default function OtterSidebar() {
	const router = useRouter();
	const messages = getMessage();
	const conversations = useRootStore(getChatConversations);
	const activeId = useRootStore(getChatActiveId);
	const isLoading = useRootStore(getChatIsLoadingConversations);
	const { setConversations, setIsLoadingConversations, removeConversation } = useRootStore(getChatActions);

	const fetchConversations = useCallback(async () => {
		setIsLoadingConversations(true);
		try {
			const response = await fetch("/api/chat/conversation");
			const result = await response.json();
			if (result.data) {
				setConversations(result.data.map((conversation: any) => ({
					id: conversation.id,
					title: conversation.title || messages.CHAT_NEW_CONVERSATION,
					totalCost: Number(conversation.totalCost) || 0,
					totalMessages: Number(conversation.totalMessages) || 0,
					updatedAt: conversation.updatedAt,
				})));
			}
		} finally {
			setIsLoadingConversations(false);
		}
	}, [messages, setConversations, setIsLoadingConversations]);

	useEffect(() => {
		fetchConversations();
	}, [fetchConversations]);

	const deleteConversation = async (id: string) => {
		try {
			await fetch(`/api/chat/conversation/${id}`, { method: "DELETE" });
			removeConversation(id);
			if (activeId === id) router.push("/chat");
		} catch {
			toast.error(messages.CHAT_FAILED_TO_DELETE_CONVERSATION);
		}
	};

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="min-h-0 flex-1">
				<ConversationList conversations={conversations} activeId={activeId} onSelect={(id) => router.push(`/chat?id=${id}`)} onDelete={deleteConversation} onNew={() => router.push("/chat")} isLoading={isLoading} />
			</div>
			<div className="flex gap-1 border-t border-stone-200 p-2 dark:border-stone-800">
					<Button asChild variant="ghost" size="sm" className="h-8 flex-1 justify-start gap-2 text-[13px] text-stone-600 dark:text-stone-300"><Link href="/chat/usage"><BarChart3 className="size-4" />{messages.CHAT_OTTER_USAGE}</Link></Button>
					<Button asChild variant="ghost" size="icon" className="size-8 text-stone-600 dark:text-stone-300"><Link href="/chat/settings" aria-label="Otter settings"><Settings className="size-4" /></Link></Button>
			</div>
		</div>
	);
}
