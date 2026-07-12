export type RuleEngineStore = {
	fieldValuesCache: Record<string, string[]>;
	fieldValuesLoading: Record<string, boolean>;
	fieldLabelsCache: Record<string, Record<string, string>>;
	setFieldValues: (field: string, values: string[]) => void;
	setFieldValuesLoading: (field: string, loading: boolean) => void;
	setFieldLabels: (field: string, labels: Record<string, string>) => void;
};
