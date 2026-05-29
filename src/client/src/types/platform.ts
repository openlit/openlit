export type OPERATION_TYPE = "llm" | "vectordb";

/**
 * Server-resolved description of an agent version used to scope analytics
 * to a single version's traffic. Hybrid mode: traces emitted by SDKs that
 * stamp `openlit.agent.version_hash` are matched by attribute, older traces
 * are matched by the version's [first_seen, last_seen] window so historical
 * data still resolves.
 */
export interface VersionFilter {
	versionHash: string;
	firstSeen: string;
	lastSeen: string;
	hasAttributeSpans: boolean;
}

export type FilterWhereConditionType = {
	timeLimit: {
		start: Date | string;
		end: Date | string;
		type: string;
	};
	offset?: number;
	limit?: number;
	selectedConfig?: Partial<{
		providers: string[];
		maxCost: number;
		models: string[];
		traceTypes: string[];
		applicationNames: string[];
		serviceNames: string[];
		spanNames: string[];
		environments: string[];
		customFilters: { attributeType: string; key: string; value: string }[];
		/**
		 * Version filter for agent-scoped views. When set, queries are scoped
		 * to spans matching the version's hash attribute and/or the version's
		 * first_seen/last_seen window (hybrid mode handles spans emitted by
		 * SDKs that don't yet stamp `openlit.agent.version_hash`).
		 */
		versionFilter: VersionFilter;
	}>;
	notOrEmpty?: { key: string }[];
	notEmpty?: { key: string }[];
	statusCode?: string[];
	operationType?: OPERATION_TYPE;
};
