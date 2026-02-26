"use client";
import { Button } from "@/components/ui/button";
import { useRootStore } from "@/store";
import { getPingStatus } from "@/selectors/database-config";
import Link from "next/link";

export default function ContextHeader({
	className = "flex w-full items-center justify-end gap-4",
}: {
	className?: string;
	successCallback?: () => void;
}) {
	const pingStatus = useRootStore(getPingStatus);

	return (
		<div className={className}>
			{pingStatus === "success" && (
				<Button
					asChild
					variant="secondary"
					className="bg-primary hover:bg-primary dark:bg-primary dark:hover:bg-primary text-stone-100 dark:text-stone-100 px-8 h-9 py-0.5"
				>
					<Link href="/context/new">Create Context</Link>
				</Button>
			)}
		</div>
	);
}
