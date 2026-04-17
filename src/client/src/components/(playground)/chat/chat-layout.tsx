"use client";

import { useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { ResizeablePanel } from "@/components/ui/resizeable-panel";
import ConversationList from "./conversation-list";
import ChatPanel from "./chat-panel";
import { useRootStore } from "@/store";
import {
	getChatConversations,
	getChatActiveId,
	getChatHasConfig,
	getChatConfigInfo,
	getChatIsLoadingConversations,
	getChatIsLoadingConfig,
	getChatActions,
} from "@/selectors/chat";
import getMessage from "@/constants/messages";
import { toast } from "sonner";

interface ChatLayoutProps {
	initialConversationId: string | null;
}

export default function ChatLayout({ initialConversationId }: ChatLayoutProps) {
	const m = getMessage();
	const router = useRouter();

	const conversations = useRootStore(getChatConversations);
	const activeId = useRootStore(getChatActiveId);
	const hasConfig = useRootStore(getChatHasConfig);
	const configInfo = useRootStore(getChatConfigInfo);
	const loadingConversations = useRootStore(getChatIsLoadingConversations);
	const loadingConfig = useRootStore(getChatIsLoadingConfig);
	const {
		setConversations,
		setActiveConversationId,
		setHasConfig,
		setConfigInfo,
		setIsLoadingConversations,
		setIsLoadingConfig,
		addConversation,
		removeConversation,
	} = useRootStore(getChatActions);

	// Sync activeId with URL param
	useEffect(() => {
		setActiveConversationId(initialConversationId);
	}, [initialConversationId, setActiveConversationId]);

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
						totalPromptTokens: Number(c.totalPromptTokens) || 0,
						totalCompletionTokens: Number(c.totalCompletionTokens) || 0,
						updatedAt: c.updatedAt,
					}))
				);
			}
		} catch {
			// Silently fail
		} finally {
			setIsLoadingConversations(false);
		}
	}, [m, setConversations, setIsLoadingConversations]);

	const fetchConfig = useCallback(async () => {
		try {
			const [configRes, providersRes] = await Promise.all([
				fetch("/api/chat/config").then((r) => r.json()),
				fetch("/api/openground/providers").then((r) => r.json()),
			]);

			const config = configRes.data;
			setHasConfig(!!config?.provider);

			if (config?.provider) {
				const providersList = Array.isArray(providersRes) ? providersRes : providersRes?.data || [];
				const providerObj = providersList.find((p: any) => p.providerId === config.provider);
				const modelObj = providerObj?.supportedModels?.find((md: any) => md.id === config.model);

				setConfigInfo({
					providerName: providerObj?.displayName || config.provider,
					modelName: modelObj?.displayName,
					modelId: config.model,
					inputPricePerMToken: modelObj?.inputPricePerMToken,
					outputPricePerMToken: modelObj?.outputPricePerMToken,
					contextWindow: modelObj?.contextWindow,
				});
			}
		} catch {
			setHasConfig(false);
		} finally {
			setIsLoadingConfig(false);
		}
	}, [setHasConfig, setConfigInfo, setIsLoadingConfig]);

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
				body: JSON.stringify({
					title: "",
					provider: configInfo?.providerName || "",
					model: configInfo?.modelId || configInfo?.modelName || "",
				}),
			});
			const result = await res.json();

			if (result.data) {
				const newId = result.data;
				addConversation({
					id: newId,
					title: m.CHAT_NEW_CONVERSATION,
					totalCost: 0,
					totalMessages: 0,
					updatedAt: new Date().toISOString(),
				});
				navigateTo(newId);
				return newId;
			}
		} catch {
			toast.error(m.CHAT_FAILED_TO_CREATE_CONVERSATION);
		}
		return null;
	}, [addConversation, navigateTo, m, configInfo]);

	const handleDeleteConversation = useCallback(
		async (id: string) => {
			try {
				await fetch(`/api/chat/conversation/${id}`, { method: "DELETE" });
				removeConversation(id);
				if (activeId === id) {
					navigateTo(null);
				}
			} catch {
				toast.error(m.CHAT_FAILED_TO_DELETE_CONVERSATION);
			}
		},
		[activeId, removeConversation, navigateTo, m]
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

			<div className="flex-1 min-w-0 bg-white dark:bg-stone-950">
				<ChatPanel
					conversationId={activeId}
					hasConfig={hasConfig && !loadingConfig}
					configInfo={configInfo}
					onNewConversation={handleNewConversation}
				/>
			</div>
		</Card>
	);
}
