"use client";

import { useEffect, useMemo } from "react";
import { Database, Layers, Plug } from "lucide-react";
import { useSearchParams } from "next/navigation";
import DatabaseConfigPage from "@/components/(playground)/database-config/database-config-page";
import DataSourcesPage from "@/components/(playground)/telemetry-source/data-sources-page";
import ProjectPageHeader from "./project-page-header";
import getMessage from "@/constants/messages";
import FeatureAccess from "@/components/rbac/feature-access";
import { getCurrentOrganisation } from "@/selectors/organisation";
import { getCurrentProject, getProjectList } from "@/selectors/project";
import { changeActiveProject, fetchProjectList } from "@/helpers/client/project";
import { useRootStore } from "@/store";

/**
 * Unified project connection management. ClickHouse connections and external
 * telemetry connectors live together because both are project integrations
 * and may be combined independently by signal and application feature.
 */
export default function ProjectConnectorsPage({ projectId }: { projectId?: string }) {
	const messages = getMessage();
	const searchParams = useSearchParams();
	const environment = searchParams.get("environment") || "production";
	const currentOrg = useRootStore(getCurrentOrganisation);
	const projects = useRootStore(getProjectList) || [];
	const currentProject = useRootStore(getCurrentProject);
	const project = useMemo(() => projects.find((item) => item.id === projectId) || (currentProject?.id === projectId ? currentProject : { id: projectId, name: projectId }), [currentProject, projectId, projects]);

	useEffect(() => {
		if (currentOrg?.id) fetchProjectList(currentOrg.id);
	}, [currentOrg?.id]);

	useEffect(() => {
		if (project?.id && currentProject?.id !== project.id) changeActiveProject(project.id);
	}, [currentProject?.id, project?.id]);

	return (
		<div className="flex h-full w-full flex-col overflow-auto text-stone-700 dark:text-stone-300">
			<ProjectPageHeader project={project} />
			<FeatureAccess access="connectors.read" requireProject>
			<div className="flex min-h-0 w-full flex-col gap-4 p-4">
			<section className="border border-primary/20 bg-primary/[0.04] p-4 dark:border-primary/30 dark:bg-primary/[0.08]">
				<div className="flex items-start gap-3">
					<Layers className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
					<div>
						<h2 className="text-sm font-semibold text-stone-950 dark:text-stone-50">{messages.PROJECT_ENVIRONMENTS}: {environment}</h2>
						<p className="mt-1 text-xs leading-5 text-muted-foreground">{messages.PROJECT_ENVIRONMENTS_DESCRIPTION}</p>
					</div>
				</div>
			</section>
			<section className="border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950">
				<div className="border-b border-stone-200 p-4 dark:border-stone-800">
					<div className="flex items-center gap-2">
						<Database className="h-4 w-4 text-primary" />
						<h2 className="text-sm font-semibold text-stone-950 dark:text-stone-50">
							{messages.PROJECT_DATABASE_CONFIGS} · ClickHouse connectors
						</h2>
					</div>
					<p className="mt-1 text-xs text-muted-foreground">
						{messages.PROJECT_CONNECTORS_DESCRIPTION}
					</p>
				</div>
				<div className="flex min-h-[360px] overflow-hidden">
					<DatabaseConfigPage />
				</div>
			</section>

			<section className="border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950">
				<div className="border-b border-stone-200 p-4 dark:border-stone-800">
					<div className="flex items-center gap-2">
						<Plug className="h-4 w-4 text-primary" />
						<h2 className="text-sm font-semibold text-stone-950 dark:text-stone-50">
							{messages.PROJECT_DATA_SOURCES} · {environment}
						</h2>
					</div>
					<p className="mt-1 text-xs text-muted-foreground">
						Connect external traces, logs, and metrics providers and route each
						signal to the connector that should serve it.
					</p>
				</div>
				<div className="flex min-h-[520px] overflow-hidden">
					<DataSourcesPage projectId={projectId} />
				</div>
			</section>
			</div>
			</FeatureAccess>
		</div>
	);
}
