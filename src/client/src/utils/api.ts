import { useRootStore } from "@/store";
import { OPENLIT_CONTEXT_HEADERS } from "@/constants/openlit-context";

type GET_DATA = {
	body?: string;
	method?: "GET" | "POST" | "PUT" | "PATCH";
	url: string;
	data?: Record<string, unknown>;
};

function getActiveDatabaseConfigId() {
	const databaseConfigList = useRootStore.getState().databaseConfig.list || [];
	return (
		databaseConfigList.find((item) => item.isCurrent)?.id ||
		databaseConfigList[0]?.id
	);
}

function getOpenLitContextHeaders() {
	if (typeof window === "undefined") return {};

	const state = useRootStore.getState();
	const headers: Record<string, string> = {};
	const organisationId = state.organisation.current?.id;
	const projectId = state.project.current?.id;
	const databaseConfigId = getActiveDatabaseConfigId();

	if (organisationId) headers[OPENLIT_CONTEXT_HEADERS.organisationId] = organisationId;
	if (projectId) headers[OPENLIT_CONTEXT_HEADERS.projectId] = projectId;
	if (databaseConfigId) headers[OPENLIT_CONTEXT_HEADERS.databaseConfigId] = databaseConfigId;

	return headers;
}

function getRequestHeaders(headers?: Record<string, string>) {
	return {
		...getOpenLitContextHeaders(),
		...(headers || {}),
	};
}

export async function getData({ body, method = "POST", url, data }: GET_DATA) {
	const hasBody = !!(body || data);
	const res = await fetch(url, {
		body: body || (data ? JSON.stringify(data) : undefined),
		method,
		headers: getRequestHeaders(
			hasBody ? { "Content-Type": "application/json" } : undefined
		),
	});
	if (!res.ok) {
		const error = await res.json();
		throw new Error(
			typeof error === "string" ? error : error?.error || error?.message || `Request failed (${res.status})`
		);
	}

	return res.json();
}

type POST_DATA = {
	url: string;
	data: Record<string, unknown>;
};

export async function postData({ url, data }: POST_DATA) {
	const res = await fetch(url, {
		method: "POST",
		headers: getRequestHeaders({ "Content-Type": "application/json" }),
		body: JSON.stringify(data),
	});
	if (!res.ok) {
		const error = await res.json();
		throw new Error(
			typeof error === "string" ? error : error?.error || error?.message || `Request failed (${res.status})`
		);
	}

	return res.json();
}

type DELETE_DATA = {
	url: string;
};

export async function deleteData({ url }: DELETE_DATA) {
	const res = await fetch(url, {
		method: "DELETE",
		headers: getRequestHeaders(),
	});
	if (!res.ok) {
		const error = await res.json();
		throw new Error(
			typeof error === "string" ? error : error?.error || error?.message || `Request failed (${res.status})`
		);
	}

	return res.json();
}
