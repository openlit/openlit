"use client";
import { Button } from "@/components/ui/button";
import { useRootStore } from "@/store";
import { getPingStatus } from "@/selectors/database-config";
import Link from "next/link";
import getMessage from "@/constants/messages";

export default function ContextHeader({
	className = "flex w-full items-center justify-end gap-4",
}: {
	className?: string;
	successCallback?: () => void;
}) {
	const pingStatus = useRootStore(getPingStatus);
	const m = getMessage();

	return (
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
}
