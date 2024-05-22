"use client";
import { lens } from "@dhmk/zustand-lens";
import { concat, set } from "lodash";

export type EvaluateStore = {
	selectedProviders: {
		provider: string;
		config: Record<string, any>;
	}[];
	prompt: string;
	isLoading: boolean;
	setProviderConfig: (path: string, value: any) => void;
	setPrompt: (prompt: string) => void;
	addProvider: (provider: string) => void;
	reset: () => void;
};

export const evaluateStoreSlice: EvaluateStore = lens((setStore, getStore) => ({
	selectedProviders: [],
	prompt: "",
	isLoading: false,
	setProviderConfig: (path: string, value: any) => {
		const storeValue = getStore();
		setStore(() => ({
			...storeValue,
			selectedProviders: set(storeValue.selectedProviders, path, value),
		}));
	},
	addProvider: (provider: string) => {
		const storeValue = getStore();
		setStore(() => ({
			...storeValue,
			selectedProviders: concat(storeValue.selectedProviders, {
				provider,
				config: {},
			}),
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
		})),
}));
