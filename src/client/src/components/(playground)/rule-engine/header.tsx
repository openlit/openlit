"use client";
import { Button } from "@/components/ui/button";
import RuleForm from "./form";
import { useRootStore } from "@/store";
import { getPingStatus } from "@/selectors/database-config";
import getMessage from "@/constants/messages";
import FeaturePageHeader from "@/components/(playground)/feature-page-header";
import { SlidersHorizontal } from "lucide-react";

export default function RuleEngineHeader({
	className = "flex w-full items-center justify-end gap-4",
	successCallback,
}: {
	className?: string;
	successCallback?: () => void;
}) {
	const pingStatus = useRootStore(getPingStatus);
	const messages = getMessage();

	const actions = (
		<div className={className}>
			{pingStatus === "success" && (
				<RuleForm successCallback={successCallback}>
					<Button
						variant="secondary"
						className="bg-primary hover:bg-primary dark:bg-primary dark:hover:bg-primary text-stone-100 dark:text-stone-100 px-8 h-9 py-0.5"
					>
						{messages.RULE_CREATE_BUTTON}
					</Button>
				</RuleForm>
			)}
		</div>
	);

	return <FeaturePageHeader eyebrow="Resources" title={messages.RULE_ENGINE_BREADCRUMB} description="Define policy-driven logic that turns context and telemetry into repeatable AI workflow decisions." icon={<SlidersHorizontal className="h-4 w-4" />} tone="border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-900/70 dark:bg-purple-950/40 dark:text-purple-300" actions={actions} />;
}
