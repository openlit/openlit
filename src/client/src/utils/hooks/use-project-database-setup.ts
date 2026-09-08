"use client";

import { useEffect, useState } from "react";
import {
	fetchDatabaseConfigList,
	projectHasDatabaseConfig,
} from "@/helpers/client/database-config";
import {
	getDatabaseConfigList,
	getDatabaseConfigListIsLoading,
} from "@/selectors/database-config";
import { getCurrentProject } from "@/selectors/project";
import { useRootStore } from "@/store";

export function useProjectDatabaseSetup() {
	const currentProject = useRootStore(getCurrentProject);
	const databaseConfigs = useRootStore(getDatabaseConfigList);
	const isDatabaseConfigLoading = useRootStore(getDatabaseConfigListIsLoading);
	const [configProjectId, setConfigProjectId] = useState<string>();

	useEffect(() => {
		if (!currentProject?.id) {
			setConfigProjectId(undefined);
			return;
		}

		const projectId = currentProject.id;
		setConfigProjectId(undefined);
		void fetchDatabaseConfigList(() => {
			setConfigProjectId(projectId);
		}, { projectId });
	}, [currentProject?.id]);

	const belongsToCurrentProject = configProjectId === currentProject?.id;

	return {
		databaseConfigs,
		hasDbConfig:
			belongsToCurrentProject && projectHasDatabaseConfig(databaseConfigs),
		isDatabaseConfigLoading,
		isDatabaseSetupLoading:
			isDatabaseConfigLoading ||
			(Boolean(currentProject?.id) && !belongsToCurrentProject),
	};
}
