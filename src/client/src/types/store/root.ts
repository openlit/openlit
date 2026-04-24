import { UserStore } from "@/types/store/user";
import { FilterStore } from "@/types/store/filter";
import { DatabaseConfigStore } from "@/types/store/database-config";
import { OpengroundStore } from "@/types/store/openground";
import { PageStore } from "@/types/store/page";
import { DashboardStore } from "./dashboards";
import { OrganisationStore } from "./organisation";
import { RuleEngineStore } from "./rule-engine";
import { ChatStore } from "./chat";

export type RootStore = {
	user: UserStore;
	filter: FilterStore;
	databaseConfig: DatabaseConfigStore;
	openground: OpengroundStore;
	page: PageStore;
	dashboards: DashboardStore;
	organisation: OrganisationStore;
	ruleEngine: RuleEngineStore;
	chat: ChatStore;
};
