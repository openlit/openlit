"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { getCurrentOrganisation } from "@/selectors/organisation";
import {
	getCurrentProject,
	getProjectIsLoading,
	getProjectList,
} from "@/selectors/project";
import { useRootStore } from "@/store";
import { cn } from "@/lib/utils";
import getMessage from "@/constants/messages";
import { changeActiveProject, fetchProjectList } from "@/helpers/client/project";

export default function HeaderProjectSwitch() {
	const messages = getMessage();
	const router = useRouter();
	const currentOrg = useRootStore(getCurrentOrganisation);
	const projects = useRootStore(getProjectList) || [];
	const selectedProject = useRootStore(getCurrentProject);
	const isLoading = useRootStore(getProjectIsLoading);

	useEffect(() => {
		if (!currentOrg?.id) {
			useRootStore.getState().project.setList([]);
			return;
		}

		fetchProjectList(currentOrg.id);
	}, [currentOrg?.id]);

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="outline"
					className="h-9 min-w-32 max-w-56 shrink-0 justify-start overflow-hidden border-stone-200 bg-stone-100/50 px-3 py-1.5 text-left font-normal text-stone-700 hover:bg-stone-200 hover:text-stone-950 dark:border-stone-800 dark:bg-stone-900/70 dark:text-stone-200 dark:hover:bg-stone-800 dark:hover:text-white"
					disabled={!currentOrg?.id || isLoading || projects.length === 0}
				>
					{isLoading ? (
						<Loader2 className="mr-2 size-3 shrink-0 animate-spin" />
					) : null}
					<span className="min-w-0 truncate text-xs font-medium">
						{selectedProject?.name ||
							(isLoading ? messages.LOADING_PROJECT : messages.NO_PROJECT)}
					</span>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent className="w-56" side="bottom" align="start">
				<DropdownMenuLabel>{messages.PROJECTS}</DropdownMenuLabel>
				<DropdownMenuSeparator />
				{projects.map((project) => (
					<DropdownMenuCheckboxItem
						key={project.id}
						checked={project.id === selectedProject?.id}
						onCheckedChange={() => changeActiveProject(project.id)}
						className={cn(project.isDefault && "font-medium")}
					>
						<span className="truncate">{project.name}</span>
					</DropdownMenuCheckboxItem>
				))}
				<DropdownMenuSeparator />
				<DropdownMenuItem
					onSelect={() => {
						router.push("/settings/organisation?tab=projects");
					}}
				>
					{messages.MANAGE_PROJECTS}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
