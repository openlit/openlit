export type RuleEngineStore = {
	fieldValuesCache: Record<string, string[]>;
	fieldValuesLoading: Record<string, boolean>;
	setFieldValues: (field: string, values: string[]) => void;
	setFieldValuesLoading: (field: string, loading: boolean) => void;
};
