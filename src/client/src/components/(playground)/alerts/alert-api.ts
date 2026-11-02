import getMessage from "@/constants/messages";
import { getRequestHeaders } from "@/utils/api";

export class AlertsRequestError extends Error {
	constructor(message: string, readonly status: number) {
		super(message);
	}
}

// Not via getData: its request cache could serve a stale list after a change.
export async function alertsRequest<T>(
	url: string,
	options: { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown } = {}
): Promise<T> {
	const response = await fetch(url, {
		method: options.method || "GET",
		headers: getRequestHeaders({ "Content-Type": "application/json" }),
		body: options.body === undefined ? undefined : JSON.stringify(options.body),
		cache: "no-store",
	});
	const payload = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw new AlertsRequestError(payload?.error || getMessage().ALERT_THRESHOLD_FAILED, response.status);
	}
	return (payload?.data ?? payload) as T;
}
