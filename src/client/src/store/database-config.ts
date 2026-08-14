"use client";
import { DatabaseConfigStore } from "@/types/store/database-config";
import { lens } from "@dhmk/zustand-lens";

const initialState = {
	ping: { status: "pending" as const },
	isLoading: false,
	list: undefined,
};

export const databaseConfigStoreSlice: DatabaseConfigStore = lens(
	(setStore, getStore) => ({
		...initialState,
		setPing: ({ error, status }) =>
			setStore(() => ({
				...getStore(),
				ping: {
					error,
					status,
				},
			})),
		setList: (list) =>
			setStore(() => ({
				...getStore(),
				list,
				isLoading: false,
			})),
		setIsLoading: (isLoading?: boolean) =>
			setStore(() => ({
				...getStore(),
				isLoading: !!isLoading,
			})),
		reset: () =>
			setStore(() => ({
				...initialState,
			})),
	})
);
