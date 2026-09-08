"use client";

import { useEffect } from "react";
import {
	fetchDatabaseConfigList,
	projectHasDatabaseConfig,
} from "@/helpers/client/database-config";
import {
	getDatabaseConfigList,
	getDatabaseConfigListIsLoading,
} from "@/selectors/database-config";
import {
	getCurrentOrganisation,
	getOrganisationIsLoading,
	getOrganisationList,
} from "@/selectors/organisation";
import {
	getCurrentProject,
	getProjectIsLoading,
	getProjectList,
} from "@/selectors/project";
import { useRootStore } from "@/store";

export function useProjectDatabaseSetup() {
	const currentProject = useRootStore(getCurrentProject);
	const databaseConfigs = useRootStore(getDatabaseConfigList);
	const isDatabaseConfigLoading = useRootStore(getDatabaseConfigListIsLoading);

	useEffect(() => {
		if (!currentProject?.id) {
			return;
		}

		void fetchDatabaseConfigList(() => {}, { projectId: currentProject.id });
	}, [currentProject?.id]);

	return {
		databaseConfigs,
		hasDbConfig: projectHasDatabaseConfig(databaseConfigs),
		isDatabaseConfigLoading,
		isDatabaseSetupLoading:
			isDatabaseConfigLoading ||
			(Boolean(currentProject?.id) && databaseConfigs === undefined),
	};
}

export function useWorkspaceSetup() {
	const currentOrg = useRootStore(getCurrentOrganisation);
	const organisationList = useRootStore(getOrganisationList);
	const isOrganisationLoading = useRootStore(getOrganisationIsLoading);
	const projects = useRootStore(getProjectList);
	const currentProject = useRootStore(getCurrentProject);
	const isProjectLoading = useRootStore(getProjectIsLoading);
	const { hasDbConfig, isDatabaseSetupLoading } = useProjectDatabaseSetup();
	const hasProject = Boolean(currentProject?.id && (projects?.length || 0) > 0);
	const isSetupLoading =
		isOrganisationLoading ||
		organisationList === undefined ||
		isProjectLoading ||
		(Boolean(currentOrg?.id) && projects === undefined) ||
		isDatabaseSetupLoading;

	return {
		currentOrg,
		hasDbConfig,
		hasProject,
		isSetupLoading,
	};
}
