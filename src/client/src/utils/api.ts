import { useRootStore } from "@/store";
import { OPENLIT_CONTEXT_HEADERS } from "@/constants/openlit-context";
import { isCacheableTelemetryUrl, withTelemetryRequestCache } from "@/utils/telemetry-request-cache";
import getMessage from "@/constants/messages";

type GET_DATA = {
	body?: string;
	method?: "GET" | "POST" | "PUT" | "PATCH";
	url: string;
	data?: Record<string, unknown>;
};

function getActiveDatabaseConfigId() {
	const list = useRootStore.getState().databaseConfig.list;
	const databaseConfigList = Array.isArray(list) ? list : [];
	return (
		databaseConfigList.find((item) => item.isCurrent)?.id ||
		databaseConfigList[0]?.id
	);
}

function isHtmlLike(value: string) {
	const text = value.trim().toLowerCase();
	return (
		text.startsWith("<!doctype") ||
		text.startsWith("<html") ||
		text.includes("data-next-hide-fouc")
	);
}

/** Never surface raw HTML documents (login pages, Next.js FOUC shells) as API errors. */
export function clientFetchErrorMessage(error: unknown, status?: number) {
	const messages = getMessage();
	const text =
		typeof error === "string"
			? error
			: error instanceof Error
				? error.message
				: error == null
					? ""
					: String(error);

	if (!text.trim() || isHtmlLike(text)) {
		return messages.API_UNEXPECTED_HTML_RESPONSE(status);
	}
	return text;
}

function throwIfFailedResponse(parsed: unknown, status: number, ok: boolean) {
	if (ok) return;
	const messages = getMessage();
	if (typeof parsed === "string") {
		throw new Error(clientFetchErrorMessage(parsed, status));
	}
	const body = parsed as { err?: string; error?: string; message?: string } | null;
	throw new Error(
		clientFetchErrorMessage(
			body?.err || body?.error || body?.message || messages.API_REQUEST_FAILED(status),
			status
		)
	);
}

/** Parse fetch body; successful responses must be JSON (not HTML login pages). */
function parseFetchBody(raw: string, ok: boolean, status: number) {
	if (!raw.trim()) return null;
	try {
		return JSON.parse(raw);
	} catch {
		const messages = getMessage();
		if (isHtmlLike(raw)) {
			throw new Error(messages.API_UNEXPECTED_HTML_RESPONSE(status));
		}
		if (ok) {
			throw new Error(messages.API_UNEXPECTED_NON_JSON_RESPONSE);
		}
		return raw;
	}
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
		const raw = await res.text();
		const parsed = parseFetchBody(raw, res.ok, res.status);
		throwIfFailedResponse(parsed, res.status, res.ok);
		if (parsed === null) throw new Error(getMessage().API_EMPTY_RESPONSE);
		return parsed;
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
	const raw = await res.text();
	const parsed = parseFetchBody(raw, res.ok, res.status);
	throwIfFailedResponse(parsed, res.status, res.ok);
	if (parsed === null) throw new Error(getMessage().API_EMPTY_RESPONSE);
	return parsed;
}

type DELETE_DATA = {
	url: string;
};

export async function deleteData({ url }: DELETE_DATA) {
	const res = await fetch(url, {
		method: "DELETE",
		headers: getRequestHeaders(),
	});
	const raw = await res.text();
	const parsed = parseFetchBody(raw, res.ok, res.status);
	throwIfFailedResponse(parsed, res.status, res.ok);
	if (parsed === null) throw new Error(getMessage().API_EMPTY_RESPONSE);
	return parsed;
}
