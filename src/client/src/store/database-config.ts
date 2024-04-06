"use client";
import { lens } from "@dhmk/zustand-lens";
import { DatabaseConfigWithActive } from "@/constants/dbConfig";

export type DatabaseStorePingStatus = "success" | "failure" | "pending";

export type DatabaseStore = {
	ping: {
		error?: string;
		status: DatabaseStorePingStatus;
	};
	list: DatabaseConfigWithActive[];
	isLoading: boolean;
	setPing: (obj: { error?: string; status: DatabaseStorePingStatus }) => void;
	setList: (u: DatabaseConfigWithActive[]) => void;
	setIsLoading: (f?: boolean) => void;
};

export const databaseConfigStoreSlice: DatabaseStore = lens((setStore, getStore) => ({
	ping: { status: "pending" },
	list: [],
	isLoading: false,
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
}));
