"use client";
import { ValueOf } from "@/utils/types";
import { lens } from "@dhmk/zustand-lens";

export const DASHBOARD_TYPE_OBJECT: Record<"llm" | "vector" | "gpu", string> = {
	llm: "llm",
	vector: "vector",
	gpu: "gpu",
};

export type DASHBOARD_TYPE = ValueOf<typeof DASHBOARD_TYPE_OBJECT>;

export type DashboardStore = {
	type?: DASHBOARD_TYPE;
	setType: (t: DASHBOARD_TYPE) => void;
};

export const dashboardStoreSlice: DashboardStore = lens((setStore) => ({
	type: DASHBOARD_TYPE_OBJECT.llm,
	setType: (type) =>
		setStore(() => ({
			type,
		})),
}));
