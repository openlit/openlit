"use client";

import { useEffect, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import ProjectPageHeader from "./project-page-header";
import { getCurrentOrganisation } from "@/selectors/organisation";
import { getCurrentProject, getProjectList } from "@/selectors/project";
import { changeActiveProject, fetchProjectList } from "@/helpers/client/project";
import { fetchDatabaseConfigList } from "@/helpers/client/database-config";
import { getDatabaseConfigList } from "@/selectors/database-config";
import { useRootStore } from "@/store";
import getMessage from "@/constants/messages";

export default function OrganisationProjectPage({ projectId }: { projectId: string }) {
	const messages = getMessage();
	const currentOrg = useRootStore(getCurrentOrganisation);
	const projects = useRootStore(getProjectList) || [];
	const currentProject = useRootStore(getCurrentProject);
	const databaseConfigs = useRootStore(getDatabaseConfigList) || [];
	const project = useMemo(
		() => projects.find((item) => item.id === projectId) || (currentProject?.id === projectId ? currentProject : { id: projectId, organisationId: "", name: projectId, slug: "-", isDefault: false, isCurrent: false, createdAt: "" }),
		[currentProject, projectId, projects]
	);

	useEffect(() => {
		if (currentOrg?.id) {
			fetchProjectList(currentOrg.id);
			fetchDatabaseConfigList(() => undefined);
		}
	}, [currentOrg?.id]);

	useEffect(() => {
		if (project?.id && currentProject?.id !== project.id) {
			changeActiveProject(project.id);
		}
	}, [currentProject?.id, project?.id]);

	const createdAt = project?.createdAt
		? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
				new Date(project.createdAt)
			)
		: "-";
	const environments = Array.from(
		new Set(databaseConfigs.map((config) => config.environment || "production"))
	);

	return (
		<div className="flex h-full w-full flex-col overflow-auto text-stone-700 dark:text-stone-300">
			<ProjectPageHeader project={project} />
			<main className="flex w-full flex-col gap-4 p-4">
				<section className="border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-950">
					<div className="flex flex-col gap-3 border-b border-stone-200 pb-4 dark:border-stone-800 md:flex-row md:items-start md:justify-between">
						<div>
							<p className="text-xs uppercase tracking-wide text-muted-foreground">{messages.PROJECT_DETAILS}</p>
							<h2 className="mt-1 text-lg font-semibold text-stone-950 dark:text-stone-50">
								{project?.name || messages.LOADING_PROJECT}
							</h2>
							<p className="mt-1 max-w-2xl text-sm text-muted-foreground">
								{messages.PROJECT_DETAILS_DESCRIPTION}
							</p>
						</div>
						<div className="flex flex-wrap gap-2">
							{project?.isCurrent ? <Badge>{messages.CURRENT}</Badge> : null}
							{project?.isDefault ? <Badge variant="outline">{messages.DEFAULT_PROJECT}</Badge> : null}
						</div>
					</div>

					<div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
						<Detail label={messages.PROJECT_NAME} value={project?.name || "-"} />
						<Detail label={messages.SLUG} value={project?.slug || "-"} mono />
						<Detail label={messages.PROJECT_ENVIRONMENT} value={environments.length ? environments.join(", ") : "production"} />
						<Detail label={messages.CREATED_AT} value={createdAt} />
					</div>
				</section>

				<section className="grid gap-4 md:grid-cols-2">
					<InfoCard label={messages.PROJECT_ID} value={project?.id || "-"} mono />
					<InfoCard label={messages.PROJECT_CONNECTION_COUNT} value={`${databaseConfigs.length}`} />
				</section>
			</main>
		</div>
	);
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
	return (
		<div className="rounded-md border border-stone-200 bg-stone-50 p-3 dark:border-stone-800 dark:bg-stone-900/60">
			<p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
			<p className={`mt-1 truncate text-sm font-medium text-stone-950 dark:text-stone-50 ${mono ? "font-mono text-xs" : ""}`}>{value}</p>
		</div>
	);
}

function InfoCard({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
	return (
		<div className="border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-950">
			<p className="text-xs text-muted-foreground">{label}</p>
			<p className={`mt-2 truncate text-sm text-stone-950 dark:text-stone-50 ${mono ? "font-mono text-xs" : "font-medium"}`}>{value}</p>
		</div>
	);
}
