"use client";

import { useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { Card } from "@/components/ui/card";
import ChatPanel from "./chat-panel";
import OtterUsageView from "./otter-usage-view";
import ChatSettingsForm from "./chat-settings-form";
import TraceDetailRequestSheet from "@/components/(playground)/observability/trace-detail-request-sheet";
import { useRootStore } from "@/store";
import {
	getChatActiveId,
	getChatHasConfig,
	getChatConfigInfo,
	getChatIsLoadingConfig,
	getChatActions,
} from "@/selectors/chat";
import getMessage from "@/constants/messages";
import { CLIENT_EVENTS } from "@/constants/events";
import { toast } from "sonner";

interface ChatLayoutProps {
	initialConversationId: string | null;
	initialView?: "chat" | "usage" | "settings";
}

export default function ChatLayout({ initialConversationId, initialView = "chat" }: ChatLayoutProps) {
	const m = getMessage();
	const router = useRouter();
	const posthog = usePostHog();

	const activeId = useRootStore(getChatActiveId);
	const hasConfig = useRootStore(getChatHasConfig);
	const configInfo = useRootStore(getChatConfigInfo);
	const loadingConfig = useRootStore(getChatIsLoadingConfig);
	const {
		setActiveConversationId,
		setHasConfig,
		setConfigInfo,
		setIsLoadingConfig,
		addConversation,
	} = useRootStore(getChatActions);

	// Sync activeId with URL param
	useEffect(() => {
		setActiveConversationId(initialConversationId);
	}, [initialConversationId, setActiveConversationId]);

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
		fetchConfig();
	}, [fetchConfig]);

	useEffect(() => {
		const event =
			initialView === "usage"
				? CLIENT_EVENTS.OTTER_USAGE_PAGE_VISITED
				: initialView === "settings"
					? CLIENT_EVENTS.OTTER_SETTINGS_PAGE_VISITED
					: CLIENT_EVENTS.OTTER_CHAT_PAGE_VISITED;
		posthog?.capture(event);
	}, [initialView, posthog]);

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

	return (
		<Card className="flex h-full w-full overflow-hidden border border-stone-200 dark:border-stone-800">
			<div className="flex-1 min-w-0 bg-white dark:bg-stone-950">
				{initialView === "usage" ? (
					<OtterUsageView />
				) : initialView === "settings" ? (
					<ChatSettingsForm />
				) : (
					<ChatPanel
						conversationId={activeId}
						hasConfig={hasConfig && !loadingConfig}
						configInfo={configInfo}
						onNewConversation={handleNewConversation}
					/>
				)}
			</div>
			<TraceDetailRequestSheet />
		</Card>
	);
}
