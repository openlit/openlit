"use client";
import { lens } from "@dhmk/zustand-lens";
import { cloneDeep, set } from "lodash";
import { PageStore, DASHBOARD_TYPE_OBJECT } from "@/types/store/page";

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
	exception: {
		visibilityColumns: {
			id: true,
			time: true,
			spanName: true,
			deploymentType: true,
			exceptionType: true,
		},
	},
	observabilityLogs: {
		visibilityColumns: {
			time: true,
			severityText: true,
			serviceName: true,
			body: true,
			traceId: true,
			spanId: false,
		},
	},
	observabilityMetrics: {
		visibilityColumns: {
			metricName: true,
			metricType: true,
			serviceName: true,
			metricUnit: true,
			latestValue: true,
			pointCount: true,
			lastSeen: true,
		},
	},
	fleethub: {
		visibilityColumns: {
			id: true,
			name: true,
			os: true,
			version: true,
			startedAt: true,
			status: true,
		}
	},
	codingAgentSessions: {
		visibilityColumns: {
			session: true,
			user: true,
			started: true,
			duration: true,
			model: true,
			tools: true,
			tokens: true,
			cost: true,
			outcome: true,
			classification: true,
			// Code-impact columns. All four default ON because
			// they're the signal columns this feature is shipped
			// for — operators can hide them via the visibility
			// menu if they want a more compact view.
			code: true,
			acceptance: true,
			commits: true,
			prs: true,
			// `coding_users` table reuses the same page store
			sessions: true,
			topVendor: true,
			mix: true,
			lastSeen: true,
			// Users table columns
			lines: true,
		},
	},
	header: {
		title: "",
		breadcrumbs: [],
	},
	setHeader: (header) => {
		setStore({
			...getStore(),
			header: {
				...getStore().header,
				title: header.title,
				breadcrumbs: header.breadcrumbs,
				description: header.description,
			}
		});
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
