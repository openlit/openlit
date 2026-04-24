"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import Otter from "@/components/svg/otter";

const OTTER_TOOLTIPS = [
	"Hi, I'm Otter 🦦, ask me anything!",
	"Otter here! Ready to dive into your data?",
	"Psst... Otter can run SQL so you don't have to.",
	"Need a dashboard? Otter's got you covered.",
	"Otter's always paddling, ready to help!",
	"Ask Otter. It's faster than googling.",
	"Otter knows your traces like the back of its paw.",
	"Click me! I won't bite, I'm an otter.",
	"Otter's a 10x engineer. Try it.",
	"Your observability BFF, Otter.",
];

export default function ChatFloatingButton() {
	const pathname = usePathname();

	// Pick a random tooltip per page load
	const tooltip = useMemo(
		() => OTTER_TOOLTIPS[Math.floor(Math.random() * OTTER_TOOLTIPS.length)],
		[]
	);

	// Don't show on the chat page itself
	if (pathname?.startsWith("/chat")) return null;

	return (
		<div className="fixed bottom-6 right-6 z-50">
			<Tooltip>
				<TooltipTrigger asChild>
					<Link href="/chat">
						<button
							aria-label="Open Otter chat"
							className="relative flex items-center justify-center h-14 w-14 rounded-full bg-white dark:bg-stone-300 border border-stone-200 dark:border-stone-700 shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 transition-all duration-200 group"
						>
							<Otter className="transition-transform group-hover:rotate-6 text-stone-700" />
							{/* Online pulse dot */}
							<span className="absolute top-1 right-1 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-white dark:ring-stone-900">
								<span className="absolute inset-0 rounded-full bg-primary animate-ping opacity-75" />
							</span>
						</button>
					</Link>
				</TooltipTrigger>
				<TooltipContent side="left" className="max-w-xs text-xs">
					<p>{tooltip}</p>
				</TooltipContent>
			</Tooltip>
		</div>
	);
}
