"use client";
import { lens } from "@dhmk/zustand-lens";
import { concat, filter, set } from "lodash";
import {
	EvalutatedResponseData,
	OpengroundStore,
	Providers,
} from "@/types/store/openground";

export const opengroundStoreSlice: OpengroundStore = lens(
	(setStore, getStore) => ({
		selectedProviders: [],
		evaluatedResponse: {
			isLoading: false,
		},
		prompt: "",
		isLoading: false,
		setProviderConfig: (path: string, value: any) => {
			const storeValue = getStore();
			const selectedProviders = set(storeValue.selectedProviders, path, value);
			setStore(() => ({
				...storeValue,
				selectedProviders: [...selectedProviders],
			}));
		},
		addProvider: (
			provider: Providers,
			configObject: Record<string, any> = {}
		) => {
			const storeValue = getStore();
			setStore(() => ({
				...storeValue,
				selectedProviders: concat(storeValue.selectedProviders, {
					provider,
					config: configObject,
				}),
			}));
		},
		removeProvider: (index: number) => {
			const storeValue = getStore();

			setStore(() => ({
				...storeValue,
				selectedProviders: filter(
					storeValue.selectedProviders,
					(_, i) => i !== index
				),
			}));
		},
		setPrompt: (prompt: string) => {
			const storeValue = getStore();
			setStore(() => ({
				...storeValue,
				prompt,
			}));
		},
		reset: () =>
			setStore(() => ({
				...getStore(),
				selectedProviders: [],
				prompt: "",
				isLoading: false,
				evaluatedResponse: {
					isLoading: false,
				},
			})),
		setEvaluatedLoading: (l: boolean) => {
			setStore(() => ({
				...getStore(),
				evaluatedResponse: {
					isLoading: l,
				},
			}));
		},
		setEvaluatedData: (data: EvalutatedResponseData) => {
			setStore(() => ({
				...getStore(),
				evaluatedResponse: {
					isLoading: false,
					data,
				},
			}));
		},
	})
);
