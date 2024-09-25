import { Button } from "@/components/ui/button";
import PromptForm from "./form";
import RouteBreadcrumbs from "../route-breadcrumbs";

export default function PromptHubHeader({
	createNew,
}: {
	createNew?: boolean;
}) {
	return (
		<div className="flex w-full items-center">
			<RouteBreadcrumbs />
			{createNew && (
				<PromptForm>
					<Button
						variant="secondary"
						className="bg-primary hover:bg-primary dark:bg-primary dark:hover:bg-primary text-stone-100 dark:text-stone-100 px-8 py-2 h-auto py-1 rounded-sm"
					>
						+ New
					</Button>
				</PromptForm>
			)}
		</div>
	);
}
