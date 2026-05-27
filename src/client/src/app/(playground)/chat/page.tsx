"use client";

import { useSearchParams } from "next/navigation";
import ChatLayout from "@/components/(playground)/chat/chat-layout";
import { RequestProvider } from "@/components/(playground)/request/request-context";

export default function ChatPage() {
	const searchParams = useSearchParams();
	const conversationId = searchParams.get("id");

	return (
		<RequestProvider>
			<div className="flex flex-col w-full h-full overflow-hidden">
				<ChatLayout initialConversationId={conversationId} />
			</div>
		</RequestProvider>
	);
}
