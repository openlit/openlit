"use client";
import { lens } from "@dhmk/zustand-lens";
import { User } from "@prisma/client";

export type UserStore = {
	details?: User;
	isFetched: boolean;
	set: (u: User) => void;
	reset: () => void;
};

export const userStoreSlice: UserStore = lens((setStore, getStore) => ({
	details: undefined,
	isFetched: false,
	set: (u) =>
		setStore(() => ({
			details: u,
			isFetched: true,
		})),
	reset: () =>
		setStore(() => ({
			...getStore(),
			details: undefined,
			isFetched: true,
		})),
}));
