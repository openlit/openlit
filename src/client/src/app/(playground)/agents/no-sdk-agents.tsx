"use client";

import Link from "next/link";
import { Bot } from "lucide-react";
import getMessage from "@/constants/messages";
import { Button } from "@/components/ui/button";

export default function NoSdkAgents() {
	return (
		<div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-stone-300 px-6 py-16 text-center dark:border-stone-700">
			<Bot className="h-10 w-10 text-stone-400 dark:text-stone-500" />
			<div className="max-w-md space-y-2">
				<h3 className="text-base font-semibold text-stone-900 dark:text-stone-100">
					{getMessage().AGENTS_NO_SDK_AGENTS_TITLE}
				</h3>
				<p className="text-sm text-stone-500 dark:text-stone-400">
					{getMessage().AGENTS_NO_SDK_AGENTS_DESCRIPTION}
				</p>
			</div>
			<Button asChild variant="secondary" size="sm">
				<Link href="/getting-started">{getMessage().AGENTS_NO_SDK_AGENTS_CTA}</Link>
			</Button>
		</div>
	);
}
