"use client";

import { lens } from "@dhmk/zustand-lens";
import { AuditLookupRecord, AuditLookupStore } from "@/types/store/audit";

const toLookupMap = (items?: AuditLookupRecord[]) =>
	(items || []).reduce<Record<string, AuditLookupRecord>>((acc, item) => {
		acc[item.id] = item;
		return acc;
	}, {});

const initialState = {
	actors: {},
	projects: {},
	databaseConfigs: {},
	targets: {},
};

export const auditStoreSlice: AuditLookupStore = lens((setStore, getStore) => ({
	...initialState,
	setLookups: (lookups) =>
		setStore(() => ({
			...getStore(),
			actors: { ...getStore().actors, ...toLookupMap(lookups.actors) },
			projects: { ...getStore().projects, ...toLookupMap(lookups.projects) },
			databaseConfigs: {
				...getStore().databaseConfigs,
				...toLookupMap(lookups.databaseConfigs),
			},
			targets: { ...getStore().targets, ...toLookupMap(lookups.targets) },
		})),
	reset: () =>
		setStore(() => ({
			...initialState,
		})),
}));
