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
	title,
	extraButtons,
	createNew = true,
}: {
	className?: string;
	title?: string;
	extraButtons?: JSX.Element;
	createNew?: boolean;
}) {
	const pingStatus = useRootStore(getPingStatus);
	const m = getMessage();
	const pageHeaderTitle = title || m.CONTEXT_TITLE;

	const actions = pingStatus === "success" && createNew ? (
		<Button
			asChild
			variant="secondary"
			className="bg-primary hover:bg-primary dark:bg-primary dark:hover:bg-primary text-stone-100 dark:text-stone-100 px-8 h-8"
		>
			<Link href="/context/new">{m.CONTEXT_CREATE}</Link>
		</Button>
	) : null;

	return <FeaturePageHeader eyebrow={getMessage().SIDEBAR_DEVELOP} title={pageHeaderTitle} icon={<BookOpen className="h-4 w-4" />} tone="border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/70 dark:bg-blue-950/40 dark:text-blue-300" actions={<div className={className}>{extraButtons}{actions}</div>} />;
}
