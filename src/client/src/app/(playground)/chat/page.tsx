"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { usePageHeader } from "@/selectors/page";
import getMessage from "@/constants/messages";
import ChatLayout from "@/components/(playground)/chat/chat-layout";

export default function ChatPage() {
	const { setHeader } = usePageHeader();
	const m = getMessage();
	const searchParams = useSearchParams();
	const conversationId = searchParams.get("id");

	useEffect(() => {
		setHeader({
			title: m.CHAT_TITLE,
			description: m.CHAT_DESCRIPTION,
			breadcrumbs: [{ title: m.CHAT_TITLE, href: "/chat" }],
		});
	}, [setHeader, m]);

	return (
		<div className="flex flex-col w-full h-full overflow-hidden">
			<ChatLayout initialConversationId={conversationId} />
		</div>
	);
}
