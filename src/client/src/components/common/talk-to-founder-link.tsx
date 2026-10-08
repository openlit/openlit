"use client";

import { Phone } from "lucide-react";
import getMessage from "@/constants/messages";
import { FOUNDER_SCHEDULE_URL } from "@/constants/external-links";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";

const headerClassName =
	"inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-stone-200 bg-white text-stone-700 shadow-sm transition-colors hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800";

export default function TalkToFounderLink() {
	const messages = getMessage();
	const link = (
		<a
			href={FOUNDER_SCHEDULE_URL}
			target="_blank"
			rel="noopener noreferrer"
			aria-label={messages.TALK_TO_FOUNDER}
			className={headerClassName}
		>
			<Phone className="size-3.5" />
		</a>
	);

	return (
		<Tooltip>
			<TooltipTrigger asChild>{link}</TooltipTrigger>
			<TooltipContent side="bottom" className="text-xs">
				<p>{messages.TALK_TO_FOUNDER}</p>
			</TooltipContent>
		</Tooltip>
	);
}
