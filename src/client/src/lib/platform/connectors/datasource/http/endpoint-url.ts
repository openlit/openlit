/**
 * Normalize user-supplied datasource endpoint URLs before persist/fetch.
 *
 * Browsers and paste paths sometimes collapse `http://host` into `http:/host`
 * (single slash). `URL` can still parse that, but we store the canonical form.
 */

import { existsSync } from "fs";

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

/** Repair `http:/host` / `https:/host` (single slash) without changing the path. */
export function canonicalizeFetchUrl(raw: string): string {
	return String(raw || "").trim().replace(/^(https?:)\/(?!\/)/i, "$1//");
}

/** Fix `http:/host` / `https:/host` and trim trailing slashes on stored endpoint bases. */
export function normalizeDatasourceEndpointUrl(raw: string): string {
	const withAuthority = canonicalizeFetchUrl(raw);
	if (!withAuthority) return withAuthority;
	try {
		const url = new URL(withAuthority);
		if (url.protocol !== "http:" && url.protocol !== "https:") {
			return withAuthority.replace(/\/+$/, "");
		}
		return url.toString().replace(/\/+$/, "");
	} catch {
		return withAuthority.replace(/\/+$/, "");
	}
}

/** True when the OpenLIT process is running inside a Docker container. */
export function isRunningInDocker(
	exists: (path: string) => boolean = existsSync
): boolean {
	try {
		return exists("/.dockerenv");
	} catch {
		return false;
	}
}

/**
 * When OpenLIT runs in Docker, `localhost` / `127.0.0.1` refer to the
 * container — not the host where Loki/Tempo/Prometheus often listen.
 * Rewrite loopback hosts to `host.docker.internal` for outbound fetches.
 * Stored config stays unchanged; only the request URL is rewritten.
 */
export function rewriteLoopbackEndpointForDocker(
	rawUrl: string,
	options: {
		enabled?: boolean;
		dockerHost?: string;
	} = {}
): string {
	const enabled = options.enabled ?? isRunningInDocker();
	if (!enabled) return rawUrl;
	const repaired = canonicalizeFetchUrl(rawUrl);
	if (!repaired) return rawUrl;
	try {
		const url = new URL(repaired);
		const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
		if (!LOOPBACK_HOSTNAMES.has(hostname)) return repaired;
		url.hostname = options.dockerHost || "host.docker.internal";
		const rewritten = url.toString();
		const originalPath = repaired.split("?")[0].split("#")[0];
		if (originalPath.endsWith("/")) return rewritten;
		return rewritten.replace(/\/+$/, "");
	} catch {
		return rawUrl;
	}
}

/** True for checkbox / switch values that mean enabled. */
export function isEnabledSetting(value: unknown): boolean {
	return value === true || value === "true" || value === 1 || value === "1";
}
