import { create } from "zustand";
import { withLenses } from "@dhmk/zustand-lens";
import { devtools } from "zustand/middleware";
import { userStoreSlice } from "./user";
import { filterStoreSlice } from "./filter";
import { databaseConfigStoreSlice } from "./database-config";
import { opengroundStoreSlice } from "./openground";
import { pageStoreSlice } from "./page";
import { RootStore } from "@/types/store/root";
import { dashboardStoreSlice } from "./dashboards";
import { organisationStoreSlice } from "./organisation";
import { projectStoreSlice } from "./project";
import { ruleEngineStoreSlice } from "./rule-engine";
import { chatStoreSlice } from "./chat";
import { agentsInstrumentationStoreSlice } from "./agents-instrumentation";

export const useRootStore = create<RootStore>()(
	devtools(
		withLenses({
			user: userStoreSlice,
			filter: filterStoreSlice,
			databaseConfig: databaseConfigStoreSlice,
			openground: opengroundStoreSlice,
			page: pageStoreSlice,
			dashboards: dashboardStoreSlice,
			organisation: organisationStoreSlice,
			project: projectStoreSlice,
			ruleEngine: ruleEngineStoreSlice,
			chat: chatStoreSlice,
			agentsInstrumentation: agentsInstrumentationStoreSlice,
		})
	)
);
