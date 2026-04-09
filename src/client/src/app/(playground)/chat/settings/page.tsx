"use client";

import { useEffect } from "react";
import { usePageHeader } from "@/selectors/page";
import getMessage from "@/constants/messages";
import ChatSettingsForm from "@/components/(playground)/chat/chat-settings-form";

export default function ChatSettingsPage() {
	const { setHeader } = usePageHeader();
	const m = getMessage();

	useEffect(() => {
		setHeader({
			title: m.CHAT_SETTINGS_TITLE,
			description: m.CHAT_SETTINGS_DESCRIPTION,
			breadcrumbs: [
				{ title: m.CHAT_TITLE, href: "/chat" },
				{ title: m.CHAT_SETTINGS_TITLE, href: "/chat/settings" },
			],
		});
	}, [setHeader, m]);

	return (
		<div className="flex flex-col w-full h-full overflow-y-auto p-6">
			<ChatSettingsForm />
		</div>
	);
}
