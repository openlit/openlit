"use client";
import { Button } from "@/components/ui/button";
import getMessage from "@/constants/messages";
import { useRootStore } from "@/store";
import { getPingStatus } from "@/selectors/database-config";
import PromptUsage from "./usage";
import Link from "next/link";
import FeaturePageHeader from "@/components/(playground)/feature-page-header";
import { Component } from "lucide-react";

export default function PromptHubHeader({
	createNew,
	className = "flex w-full items-center justify-end gap-3",
}: {
	createNew?: boolean;
	className?: string;
}) {
	const m = getMessage();
	const pingStatus = useRootStore(getPingStatus);

	const actions = (
		<div className={className}>
			{pingStatus === "success" && <PromptUsage />}
			{createNew && pingStatus === "success" && (
				<Button
					asChild
					variant="secondary"
					className="bg-primary hover:bg-primary dark:bg-primary dark:hover:bg-primary text-stone-100 dark:text-stone-100 px-8 h-9 py-1"
				>
					<Link href="/prompt-hub/new">{m.PROMPT_HUB_CREATE}</Link>
				</Button>
			)}
		</div>
	);

	return <FeaturePageHeader eyebrow="Resources" title={m.FEATURE_PROMPTS} description="Design, version, and reuse prompts so teams can ship consistent AI behavior across products." icon={<Component className="h-4 w-4" />} tone="border-pink-200 bg-pink-50 text-pink-700 dark:border-pink-900/70 dark:bg-pink-950/40 dark:text-pink-300" actions={actions} />;
}
