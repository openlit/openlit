import { lens } from "@dhmk/zustand-lens";
import { RuleEngineStore } from "@/types/store/rule-engine";

export const ruleEngineStoreSlice: RuleEngineStore = lens((setStore, getStore) => ({
	fieldValuesCache: {},
	fieldValuesLoading: {},
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
}));
