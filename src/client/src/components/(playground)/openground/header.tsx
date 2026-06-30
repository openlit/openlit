import { Button } from "@/components/ui/button";
import { getEvaluatedResponse, resetOpenground } from "@/selectors/openground";
import { useRootStore } from "@/store";
import Link from "next/link";
import { MonitorPlay, SettingsIcon } from "lucide-react";
import getMessage from "@/constants/messages";
import FeaturePageHeader from "@/components/(playground)/feature-page-header";

export function OpengroundActions({
	className = "flex items-center justify-end gap-2",
	validateResponse = true,
}: {
	className?: string;
	validateResponse?: boolean;
}) {
	const evaluatedResponse = useRootStore(getEvaluatedResponse);
	const resetOpengroundData = useRootStore(resetOpenground);

	const showButton =
		(validateResponse && !!evaluatedResponse.data) || !validateResponse;

	if (!showButton) return null;

	return (
		<div className={className}>
			<Link href="/manage-models">
				<Button variant="outline" size="sm" className="h-8">
					<SettingsIcon className="mr-1.5 size-3.5" />
					{getMessage().OPENGROUND_MANAGE_MODELS}
				</Button>
			</Link>
			<Link href="/openground/new" onClick={resetOpengroundData}>
				<Button
					variant="secondary"
					size="sm"
					className="h-8 bg-primary text-white hover:bg-primary/90 dark:bg-primary dark:text-white dark:hover:bg-primary/90"
				>
					{getMessage().OPENGROUND_CREATE_NEW_PLAYGROUND}
				</Button>
			</Link>
		</div>
	);
}

export default function OpengroundHeader({
	validateResponse = true,
}: {
	validateResponse?: boolean;
}) {
	const messages = getMessage();

	return (
		<FeaturePageHeader
			eyebrow="Resources"
			title={messages.FEATURE_OPENGROUND}
			icon={<MonitorPlay className="size-4" />}
			tone="border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-900/70 dark:bg-indigo-950/40 dark:text-indigo-300"
			actions={
				<OpengroundActions validateResponse={validateResponse} />
			}
		/>
	);
}
