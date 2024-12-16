"use client";
import { ValueOf } from "@/utils/types";
import { lens } from "@dhmk/zustand-lens";
import { cloneDeep, set } from "lodash";

export const DASHBOARD_TYPE_OBJECT: Record<"llm" | "vector" | "gpu", string> = {
	llm: "llm",
	vector: "vector",
	gpu: "gpu",
};

export type DASHBOARD_TYPE = ValueOf<typeof DASHBOARD_TYPE_OBJECT>;

export type REQUEST_VISIBILITY_COLUMNS = Record<
	"id" | "time" | "requestDuration" | "spanName" | "serviceName",
	boolean
>;

type PAGE = "dashboard" | "request";

export type PageStore = {
	dashboard: {
		type: DASHBOARD_TYPE;
	};
	request: {
		visibilityColumns: Partial<REQUEST_VISIBILITY_COLUMNS>;
	};
	setData: (p: PAGE, keyPath: string, value: unknown) => void;
};

export const pageStoreSlice: PageStore = lens((setStore, getStore) => ({
	dashboard: {
		type: DASHBOARD_TYPE_OBJECT.llm,
	},
	request: {
		visibilityColumns: {
			id: true,
			time: true,
			requestDuration: true,
			spanName: true,
			serviceName: true,
		},
	},
	setData: (page, keyPath, value) => {
		const store = getStore();
		let pageObject = cloneDeep(store[page as keyof typeof store]);

		set(pageObject, keyPath, value);

		setStore({
			...store,
			[page]: {
				...pageObject,
			},
		});
	},
}));
