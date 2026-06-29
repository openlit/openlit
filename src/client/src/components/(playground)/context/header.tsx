"use client";
import { Button } from "@/components/ui/button";
import { useRootStore } from "@/store";
import { getPingStatus } from "@/selectors/database-config";
import Link from "next/link";
import getMessage from "@/constants/messages";
import FeaturePageHeader from "@/components/(playground)/feature-page-header";
import { BookOpen } from "lucide-react";

export default function ContextHeader({
	className = "flex w-full items-center justify-end gap-4",
}: {
	className?: string;
	successCallback?: () => void;
}) {
	const pingStatus = useRootStore(getPingStatus);
	const m = getMessage();

	const actions = (
		<div className={className}>
			{pingStatus === "success" && (
				<Button
					asChild
					variant="secondary"
					className="bg-primary hover:bg-primary dark:bg-primary dark:hover:bg-primary text-stone-100 dark:text-stone-100 px-8 h-9 py-0.5"
				>
					<Link href="/context/new">{m.CONTEXT_CREATE}</Link>
				</Button>
			)}
		</div>
	);

	return <FeaturePageHeader eyebrow="Resources" title={m.CONTEXT_TITLE} description="Build reusable knowledge blocks that give prompts, rules, and agents the right business context at runtime." icon={<BookOpen className="h-4 w-4" />} tone="border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/70 dark:bg-blue-950/40 dark:text-blue-300" actions={actions} />;
}
