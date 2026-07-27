"use client";

import { useEffect, useMemo } from "react";
import { Database, Plug } from "lucide-react";
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
			<section className="border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950">
				<div className="border-b border-stone-200 p-4 dark:border-stone-800">
					<div className="flex items-center gap-2">
						<Database className="h-4 w-4 text-primary" />
						<h2 className="text-sm font-semibold text-stone-950 dark:text-stone-50">
							{messages.PROJECT_DATABASE_CONFIGS}
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
							{messages.PROJECT_DATA_SOURCES}
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
