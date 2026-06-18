"use client";

import Link from "next/link";
import { useEffect, useMemo } from "react";
import { ArrowLeft, Database, FolderKanban } from "lucide-react";
import DatabaseConfigPage from "@/components/(playground)/database-config/database-config-page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
	const projects = useRootStore(getProjectList) || [];
	const currentProject = useRootStore(getCurrentProject);
	const project = useMemo(
		() => projects.find((item) => item.id === projectId),
		[projectId, projects]
	);

	useEffect(() => {
		if (currentOrg?.id) fetchProjectList(currentOrg.id);
	}, [currentOrg?.id]);

	useEffect(() => {
		if (project?.id && currentProject?.id !== project.id) {
			changeActiveProject(project.id);
		}
	}, [currentProject?.id, project?.id]);

	return (
		<div className="flex h-full w-full flex-col gap-4 overflow-auto p-4 text-stone-700 dark:text-stone-300">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="space-y-1">
					<Button asChild variant="ghost" size="sm" className="h-8 px-2">
						<Link href="/organisation">
							<ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
							{messages.BACK_TO_ORGANISATION}
						</Link>
					</Button>
					<div>
						<h1 className="flex items-center gap-2 text-xl font-semibold text-stone-950 dark:text-stone-50">
							<FolderKanban className="h-5 w-5 text-primary" />
							{project?.name || messages.LOADING_PROJECT}
						</h1>
						<p className="text-sm text-muted-foreground">
							{messages.PROJECT_DETAILS_DESCRIPTION}
						</p>
					</div>
				</div>
				<div className="flex gap-2">
					{project?.isCurrent ? <Badge className="h-6">{messages.CURRENT}</Badge> : null}
					{project?.isDefault ? (
						<Badge variant="outline" className="h-6">
							{messages.DEFAULT_PROJECT}
						</Badge>
					) : null}
				</div>
			</div>

			<div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
				<section className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-950">
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

				<section className="min-h-[520px] overflow-hidden rounded-lg border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950">
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
					<div className="flex h-[620px] min-h-0">
						<DatabaseConfigPage />
					</div>
				</section>
			</div>
		</div>
	);
}
