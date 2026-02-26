"use client";
import { Button } from "@/components/ui/button";
import RuleForm from "./form";
import { useRootStore } from "@/store";
import { getPingStatus } from "@/selectors/database-config";

export default function RuleEngineHeader({
	className = "flex w-full items-center justify-end gap-4",
	successCallback,
}: {
	className?: string;
	successCallback?: () => void;
}) {
	const pingStatus = useRootStore(getPingStatus);

	return (
		<div className={className}>
			{pingStatus === "success" && (
				<RuleForm successCallback={successCallback}>
					<Button
						variant="secondary"
						className="bg-primary hover:bg-primary dark:bg-primary dark:hover:bg-primary text-stone-100 dark:text-stone-100 px-8 h-9 py-0.5"
					>
						Create Rule
					</Button>
				</RuleForm>
			)}
		</div>
	);
}
