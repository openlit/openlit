"use client";
import { lens } from "@dhmk/zustand-lens";
import { concat, filter, set, slice } from "lodash";

export type Providers = "anthropic" | "cohere" | "mistral" | "openai";

export type ProviderType = {
	key: Providers;
	title: string;
	subTitle: string;
	logo: string;
	logoDark: string;
	config: Record<string, any>[];
};

export type EvalutatedResponseData = Array<[string, any]>;

export type OpengroundStore = {
	selectedProviders: {
		provider: Providers;
		config: Record<string, any>;
	}[];
	evaluatedResponse: {
		isLoading: boolean;
		data?: EvalutatedResponseData;
	};
	prompt: string;
	isLoading: boolean;
	setProviderConfig: (path: string, value: any) => void;
	setPrompt: (prompt: string) => void;
	addProvider: (
		provider: Providers,
		configObject?: Record<string, any>
	) => void;
	removeProvider: (index: number) => void;
	reset: () => void;
	setEvaluatedLoading: (l: boolean) => void;
	setEvaluatedData: (data: EvalutatedResponseData) => void;
};

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
