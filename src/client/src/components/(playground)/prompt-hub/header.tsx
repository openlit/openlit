"use client";
import { Button } from "@/components/ui/button";
import getMessage from "@/constants/messages";
import { useRootStore } from "@/store";
import { getPingStatus } from "@/selectors/database-config";
import PromptUsage from "./usage";
import Link from "next/link";
import FeaturePageHeader from "@/components/(playground)/feature-page-header";
import { Component } from "lucide-react";
import type { ReactNode } from "react";

export default function PromptHubHeader({
	title,
	createNew,
	className = "flex w-full items-center justify-end gap-3",
	extraButtons,
	leading,
	promptUsage = true,
}: {
	title?: string;
	createNew?: boolean;
	className?: string;
	extraButtons?: JSX.Element;
	/** Left-side control (icon-only back on detail pages). */
	leading?: ReactNode;
	promptUsage?: boolean;
}) {
	const m = getMessage();
	const pingStatus = useRootStore(getPingStatus);
	const pageHeaderTitle = title || m.FEATURE_PROMPTS;
	const actions = (
		<div className={className}>
			{pingStatus === "success" && promptUsage && <PromptUsage />}
			{createNew && pingStatus === "success" && (
				<Button
					asChild
					variant="secondary"
					className="bg-primary hover:bg-primary dark:bg-primary dark:hover:bg-primary text-stone-100 dark:text-stone-100 px-8 h-8"
				>
					<Link href="/prompt-hub/new">{m.PROMPT_HUB_CREATE}</Link>
				</Button>
			)}
			{extraButtons}
		</div>
	);

	return (
		<FeaturePageHeader
			eyebrow="Resources"
			title={pageHeaderTitle}
			icon={<Component className="h-4 w-4" />}
			tone="border-pink-200 bg-pink-50 text-pink-700 dark:border-pink-900/70 dark:bg-pink-950/40 dark:text-pink-300"
			leading={leading}
			actions={actions}
		/>
	);
}
