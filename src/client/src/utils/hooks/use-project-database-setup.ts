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
import { getCurrentProject } from "@/selectors/project";
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
