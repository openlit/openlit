import { Button } from "@/components/ui/button";
import PromptForm from "./form";
import RouteBreadcrumbs from "../route-breadcrumbs";
import { useRootStore } from "@/store";
import { getPingStatus } from "@/selectors/database-config";
import PromptUsage from "./usage";

export default function PromptHubHeader({
	createNew,
}: {
	createNew?: boolean;
}) {
	const pingStatus = useRootStore(getPingStatus);

	return (
		<div className="flex w-full items-center">
			<RouteBreadcrumbs />
			{pingStatus === "success" && <PromptUsage />}
			{createNew && pingStatus === "success" && (
				<PromptForm>
					<Button
						variant="secondary"
						className="bg-primary hover:bg-primary dark:bg-primary dark:hover:bg-primary text-stone-100 dark:text-stone-100 px-8 h-auto py-1 rounded-sm"
					>
						+ New
					</Button>
				</PromptForm>
			)}
		</div>
	);
}
