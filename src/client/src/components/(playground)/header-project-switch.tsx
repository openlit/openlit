"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ChevronDown } from "lucide-react";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { headerScopeTriggerClassName } from "./header-scope-pill";

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
				<button
					type="button"
					className={headerScopeTriggerClassName}
					disabled={!currentOrg?.id || isLoading || projects.length === 0}
				>
					{isLoading ? (
						<Loader2 className="size-3 shrink-0 animate-spin" />
					) : null}
					<span className="min-w-0 truncate">
						{selectedProject?.name ||
							(isLoading ? messages.LOADING_PROJECT : messages.NO_PROJECT)}
					</span>
					<ChevronDown className="size-3 shrink-0 opacity-50" />
				</button>
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
						router.push("/organisation?tab=projects");
					}}
				>
					{messages.MANAGE_PROJECTS}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
