"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import ChatLayout from "@/components/(playground)/chat/chat-layout";
import { RequestProvider } from "@/components/(playground)/request/request-context";
import { useWorkspaceSetup } from "@/utils/hooks/use-project-database-setup";
import { fetchProjectList } from "@/helpers/client/project";
import Loader from "@/components/common/loader";

export default function ChatPage() {
	const searchParams = useSearchParams();
	const conversationId = searchParams.get("id");
	const initialPrompt = searchParams.get("prompt");
	const { currentOrg, isSetupLoading } = useWorkspaceSetup();

	useEffect(() => {
		if (currentOrg?.id) fetchProjectList(currentOrg.id);
	}, [currentOrg?.id]);

	if (isSetupLoading) {
		return (
			<div className="flex h-full w-full items-center justify-center">
				<Loader />
			</div>
		);
	}

	return (
		<RequestProvider>
			<div className="flex flex-col w-full h-full overflow-hidden">
				<ChatLayout initialConversationId={conversationId} initialPrompt={initialPrompt} />
			</div>
		</RequestProvider>
	);
}
