import { RootStore } from "@/store";

export const getSelectedProviders = (state: RootStore) =>
	state.evaluate.selectedProviders;

export const getPrompt = (state: RootStore) => state.evaluate.prompt;

export const getIsLoading = (state: RootStore) => state.evaluate.isLoading;

export const setProviderConfig = (state: RootStore) =>
	state.evaluate.setProviderConfig;

export const addProvider = (state: RootStore) => state.evaluate.addProvider;

export const setPrompt = (state: RootStore) => state.evaluate.setPrompt;

export const resetEvaluate = (state: RootStore) => state.evaluate.reset;
