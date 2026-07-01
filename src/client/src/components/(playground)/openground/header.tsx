import { Button } from "@/components/ui/button";
import { getEvaluatedResponse, resetOpenground } from "@/selectors/openground";
import { useRootStore } from "@/store";
import Link from "next/link";
import { ArrowLeftIcon, MonitorPlay, SettingsIcon } from "lucide-react";
import getMessage from "@/constants/messages";
import FeaturePageHeader from "@/components/(playground)/feature-page-header";
import { useRouter } from "next/navigation";

export function OpengroundActions({
	className = "flex items-center justify-end gap-2",
	validateResponse = true,
	extraButton,
}: {
	className?: string;
	validateResponse?: boolean;
	extraButton?: JSX.Element;
}) {
	const evaluatedResponse = useRootStore(getEvaluatedResponse);
	const resetOpengroundData = useRootStore(resetOpenground);
	const router = useRouter();
	const showButton =
		(validateResponse && !!evaluatedResponse.data) || !validateResponse;

	if (!showButton) return (
		<div className={className}>
			<Button variant="outline" size="sm" className="h-8" onClick={() => router.back()}>
				<ArrowLeftIcon className="mr-1.5 size-3.5" />
					{getMessage().BACK}
			</Button>
			{extraButton}
		</div>
	);

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
			{extraButton}
		</div>
	);
}

export default function OpengroundHeader({
	validateResponse = true,
	title,
	extraButton,
}: {
	validateResponse?: boolean;
	title?: string;
	extraButton?: JSX.Element;
}) {
	const messages = getMessage();
	const pageHeaderTitle = title || messages.FEATURE_OPENGROUND

	return (
		<FeaturePageHeader
			eyebrow="Resources"
			title={pageHeaderTitle}
			icon={<MonitorPlay className="size-4" />}
			tone="border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-900/70 dark:bg-indigo-950/40 dark:text-indigo-300"
			actions={
				<OpengroundActions validateResponse={validateResponse} extraButton={extraButton} />
			}
		/>
	);
}
