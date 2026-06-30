import { Button } from "@/components/ui/button";
import SecretForm from "./form";
import { useRootStore } from "@/store";
import { getPingStatus } from "@/selectors/database-config";
import VaultUsage from "./usage";
import FeaturePageHeader from "@/components/(playground)/feature-page-header";
import getMessage from "@/constants/messages";
import { BookKey } from "lucide-react";

export default function VaultHeader({
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
			{pingStatus === "success" && <VaultUsage />}
			{pingStatus === "success" && (
				<SecretForm successCallback={successCallback}>
					<Button
						variant="secondary"
						className="bg-primary hover:bg-primary dark:bg-primary dark:hover:bg-primary text-stone-100 dark:text-stone-100 px-8 h-9 py-0.5"
					>
						Create new
					</Button>
				</SecretForm>
			)}
		</div>
	);

	return <FeaturePageHeader eyebrow="Resources" title={messages.FEATURE_VAULT} icon={<BookKey className="h-4 w-4" />} tone="border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-300" actions={actions} />;
}
