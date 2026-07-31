import { useRootStore } from "@/store";
import { OPENLIT_CONTEXT_HEADERS } from "@/constants/openlit-context";
import { isCacheableTelemetryUrl, withTelemetryRequestCache } from "@/utils/telemetry-request-cache";

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
	const environment = state.project.currentEnvironment;

	if (organisationId) headers[OPENLIT_CONTEXT_HEADERS.organisationId] = organisationId;
	if (projectId) headers[OPENLIT_CONTEXT_HEADERS.projectId] = projectId;
	if (databaseConfigId) headers[OPENLIT_CONTEXT_HEADERS.databaseConfigId] = databaseConfigId;
	if (environment) headers[OPENLIT_CONTEXT_HEADERS.environment] = environment;

	return headers;
}

export function getRequestHeaders(headers?: Record<string, string>) {
	return {
		...getOpenLitContextHeaders(),
		...(headers || {}),
	};
}

export async function getData({ body, method = "POST", url, data }: GET_DATA) {
	const payload = body || (data ? JSON.stringify(data) : undefined);
	const hasBody = !!payload;
	const environment = getOpenLitContextHeaders()[OPENLIT_CONTEXT_HEADERS.environment];
	// Keep environment out of the request URL, but include it in the client cache
	// identity so switching environments cannot reuse another environment's data.
	const cacheUrl = environment ? `${url}::${environment}` : url;

	return withTelemetryRequestCache(cacheUrl, payload, async () => {
		const controller = isCacheableTelemetryUrl(url) ? new AbortController() : undefined;
		const timeout = controller ? setTimeout(() => controller.abort(), 15_000) : undefined;
		try {
		const res = await fetch(url, {
			body: payload,
			method,
			signal: controller?.signal,
			headers: getRequestHeaders(
				hasBody ? { "Content-Type": "application/json" } : undefined
			),
		});
		if (!res.ok) {
			const error = await res.json();
			throw new Error(
				typeof error === "string"
					? error
					: error?.error || error?.message || `Request failed (${res.status})`
			);
		}

		return res.json();
		} finally {
			if (timeout !== undefined) clearTimeout(timeout);
		}
	});
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
