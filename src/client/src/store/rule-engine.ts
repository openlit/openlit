import { lens } from "@dhmk/zustand-lens";
import { RuleEngineStore } from "@/types/store/rule-engine";

export const ruleEngineStoreSlice: RuleEngineStore = lens((setStore, getStore) => ({
	fieldValuesCache: {},
	fieldValuesLoading: {},
	fieldLabelsCache: {},
	setFieldValues: (field: string, values: string[]) => {
		setStore(() => ({
			...getStore(),
			fieldValuesCache: {
				...getStore().fieldValuesCache,
				[field]: values,
			},
		}));
	},
	setFieldValuesLoading: (field: string, loading: boolean) => {
		setStore(() => ({
			...getStore(),
			fieldValuesLoading: {
				...getStore().fieldValuesLoading,
				[field]: loading,
			},
		}));
	},
	setFieldLabels: (field: string, labels: Record<string, string>) => {
		setStore(() => ({
			...getStore(),
			fieldLabelsCache: {
				...getStore().fieldLabelsCache,
				[field]: labels,
			},
		}));
	},
}));
