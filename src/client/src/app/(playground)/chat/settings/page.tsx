"use client";

import ChatLayout from "@/components/(playground)/chat/chat-layout";
import { RequestProvider } from "@/components/(playground)/request/request-context";

export default function ChatSettingsPage() {
	return (
		<RequestProvider>
			<div className="flex flex-col w-full h-full overflow-hidden">
				<ChatLayout initialConversationId={null} initialView="settings" />
			</div>
		</RequestProvider>
	);
}
