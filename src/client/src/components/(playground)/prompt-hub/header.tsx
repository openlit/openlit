"use client";
import { Button } from "@/components/ui/button";
import { useRootStore } from "@/store";
import { getPingStatus } from "@/selectors/database-config";
import PromptUsage from "./usage";
import Link from "next/link";

export default function PromptHubHeader({
	createNew,
	className = "flex w-full items-center justify-end gap-3",
}: {
	createNew?: boolean;
	className?: string;
}) {
	const pingStatus = useRootStore(getPingStatus);

	return (
		<div className={className}>
			{pingStatus === "success" && <PromptUsage />}
			{createNew && pingStatus === "success" && (
				<Button
					asChild
					variant="secondary"
					className="bg-primary hover:bg-primary dark:bg-primary dark:hover:bg-primary text-stone-100 dark:text-stone-100 px-8 h-9 py-1"
				>
					<Link href="/prompt-hub/new">Create new</Link>
				</Button>
			)}
		</div>
	);
}
