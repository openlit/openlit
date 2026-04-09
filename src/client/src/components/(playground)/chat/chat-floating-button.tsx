"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import getMessage from "@/constants/messages";

export default function ChatFloatingButton() {
	const pathname = usePathname();
	const m = getMessage();

	// Don't show on the chat page itself
	if (pathname?.startsWith("/chat")) return null;

	return (
		<div className="fixed bottom-6 right-6 z-50">
			<Tooltip>
				<TooltipTrigger asChild>
					<Link href="/chat">
						<Button
							size="icon"
							className="h-12 w-12 rounded-full shadow-lg hover:shadow-xl transition-shadow bg-stone-900 hover:bg-stone-800 dark:bg-stone-100 dark:hover:bg-stone-200"
						>
							<MessageSquare className="h-5 w-5 text-white dark:text-stone-900" />
						</Button>
					</Link>
				</TooltipTrigger>
				<TooltipContent side="left">
					<p>{m.CHAT_TITLE}</p>
				</TooltipContent>
			</Tooltip>
		</div>
	);
}
