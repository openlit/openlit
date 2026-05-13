"use client";

import ChatLayout from "@/components/(playground)/chat/chat-layout";

export default function ChatUsagePage() {
	return (
		<div className="flex flex-col w-full h-full overflow-hidden">
			<ChatLayout initialConversationId={null} initialView="usage" />
		</div>
	);
}
