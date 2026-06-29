"use client";

import { useEffect, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Database, FolderKanban } from "lucide-react";
import DatabaseConfigPage from "@/components/(playground)/database-config/database-config-page";
import ProjectPageHeader from "./project-page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getCurrentOrganisation } from "@/selectors/organisation";
import { getCurrentProject, getProjectList } from "@/selectors/project";
import { changeActiveProject, fetchProjectList } from "@/helpers/client/project";
import { useRootStore } from "@/store";
import getMessage from "@/constants/messages";

export default function OrganisationProjectPage({
	projectId,
}: {
	projectId: string;
}) {
	const messages = getMessage();
	const currentOrg = useRootStore(getCurrentOrganisation);
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const projects = useRootStore(getProjectList) || [];
	const currentProject = useRootStore(getCurrentProject);
	const project = useMemo(
		() => projects.find((item) => item.id === projectId),
		[projectId, projects]
	);
	const selectedTab = searchParams.get("tab") === "database" ? "database" : "overview";
	const setSelectedTab = (tab: string) => {
		const params = new URLSearchParams(searchParams.toString());
		if (tab === "overview") params.delete("tab");
		else params.set("tab", tab);
		router.replace(`${pathname}${params.size ? `?${params}` : ""}`);
	};

	useEffect(() => {
		if (currentOrg?.id) fetchProjectList(currentOrg.id);
	}, [currentOrg?.id]);

	useEffect(() => {
		if (project?.id && currentProject?.id !== project.id) {
			changeActiveProject(project.id);
		}
	}, [currentProject?.id, project?.id]);

	return (
			<div className="flex h-full w-full flex-col gap-4 overflow-auto p-3 text-stone-700 dark:text-stone-300">
				<ProjectPageHeader project={project} />

				<Tabs value={selectedTab} onValueChange={setSelectedTab} className="flex min-h-0 w-full flex-1 flex-col">
				<TabsList className="h-auto w-full justify-start rounded-md border border-stone-200 bg-white p-1 dark:border-stone-800 dark:bg-stone-950 md:w-auto">
					<TabsTrigger value="overview" className="gap-1.5 text-xs"><FolderKanban className="h-3.5 w-3.5" />{messages.PROJECT_OVERVIEW}</TabsTrigger>
					<TabsTrigger value="database" className="gap-1.5 text-xs"><Database className="h-3.5 w-3.5" />{messages.PROJECT_DATABASE_CONFIGS}</TabsTrigger>
				</TabsList>
					<TabsContent value="overview" className="mt-0 data-[state=active]:mt-3">
				<section className="rounded-md border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-950">
					<div className="mb-4 flex items-center gap-2">
						<FolderKanban className="h-4 w-4 text-primary" />
						<h2 className="text-sm font-semibold text-stone-950 dark:text-stone-50">
							{messages.PROJECT_DETAILS}
						</h2>
					</div>
					<div className="space-y-3 text-sm">
						<div>
							<p className="text-xs uppercase text-muted-foreground">
								{messages.PROJECT_NAME}
							</p>
							<p className="font-medium text-stone-950 dark:text-stone-50">
								{project?.name || "-"}
							</p>
						</div>
						<div>
							<p className="text-xs uppercase text-muted-foreground">
								{messages.SLUG}
							</p>
							<p className="font-mono text-xs text-stone-700 dark:text-stone-300">
								{project?.slug || "-"}
							</p>
						</div>
					</div>
				</section>
				</TabsContent>

					<TabsContent value="database" className="mt-0 data-[state=active]:mt-3">
				<section className="min-h-[520px] overflow-hidden rounded-md border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950">
					<div className="border-b border-stone-200 p-4 dark:border-stone-800">
						<div className="flex items-center gap-2">
							<Database className="h-4 w-4 text-primary" />
							<h2 className="text-sm font-semibold text-stone-950 dark:text-stone-50">
								{messages.PROJECT_DATABASE_CONFIGS}
							</h2>
						</div>
						<p className="mt-1 text-xs text-muted-foreground">
							{messages.PROJECT_DATABASE_CONFIGS_DESCRIPTION}
						</p>
					</div>
					<div className="flex h-[clamp(360px,calc(100dvh-320px),620px)] min-h-0 overflow-hidden">
						<DatabaseConfigPage />
					</div>
				</section>
				</TabsContent>
			</Tabs>
		</div>
	);
}
