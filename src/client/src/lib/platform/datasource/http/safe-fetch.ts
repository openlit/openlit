/**
 * SSRF-safe server-side fetch for user-supplied observability endpoints
 * (Prometheus, Loki, Tempo, Grafana, Jaeger, Victoria, Datadog, New Relic).
 *
 * Enforces rule F4: never treat URLs as strings, only allow http/https, reject
 * `javascript:`/`data:` and credentials-in-URL, and block requests that
 * resolve to internal / loopback / link-local ranges. DNS lookup and fetch are
 * injectable so this is unit-testable without real network access.
 */

import net from "net";
import { promises as dns } from "dns";
import { withRetry, withSourceConcurrency, type RetryOptions } from "./limits";

export type LookupFn = (hostname: string) => Promise<{ address: string }[]>;

/** HTTP error carrying the vendor response status so retry can classify it. */
export class SourceResponseError extends Error {
	readonly status: number;
	constructor(status: number, message: string) {
		super(message);
		this.name = "SourceResponseError";
		this.status = status;
	}
}

const BLOCKED_HOSTNAMES = new Set([
	"localhost",
	"metadata.google.internal",
	"metadata.goog",
	"169.254.169.254",
]);

/** HTTP redirect status codes we follow manually (with per-hop re-validation). */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Cap on manually-followed redirects to avoid loops. */
const MAX_REDIRECTS = 5;

/** Classify an IP (v4 or v6) as private / loopback / link-local / unspecified. */
export function isPrivateAddress(ip: string): boolean {
	const version = net.isIP(ip);
	if (version === 4) {
		const p = ip.split(".").map(Number);
		if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
		if (p[0] === 127) return true; // loopback
		if (p[0] === 10) return true; // private
		if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true; // private
		if (p[0] === 192 && p[1] === 168) return true; // private
		if (p[0] === 169 && p[1] === 254) return true; // link-local
		if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT
		if (p[0] === 0) return true; // unspecified / this-network
		return false;
	}
	if (version === 6) {
		const lower = ip.toLowerCase().replace(/^\[|\]$/g, "");
		if (lower === "::1" || lower === "::") return true; // loopback / unspecified
		if (lower.startsWith("fe80:")) return true; // link-local
		if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA
		// IPv4-mapped IPv6 (::ffff:a.b.c.d)
		const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
		if (mapped) return isPrivateAddress(mapped[1]);
		return false;
	}
	// Not an IP literal.
	return false;
}

export class SsrfError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SsrfError";
	}
}

export interface AssertUrlOptions {
	/** Permit plain http (self-hosted OSS backends). Default false (https only). */
	allowHttp?: boolean;
	/** Injectable DNS resolver for tests. */
	lookup?: LookupFn;
}

const defaultLookup: LookupFn = async (hostname) => {
	const results = await dns.lookup(hostname, { all: true });
	return results.map((r) => ({ address: r.address }));
};

/**
 * Validate a user-supplied URL for outbound fetch. Throws `SsrfError` on any
 * violation. Returns the parsed URL when safe.
 *
 * Residual note: Node's global `fetch` re-resolves DNS at connect time, so a
 * hostname that passes here could in theory rebind to a private address before
 * the socket opens (TOCTOU). `safeFetch` re-runs this check on every redirect
 * hop, but airtight rebinding protection requires socket-level egress control
 * (a pinned dispatcher / proxy) that is out of scope for the self-hosted model.
 */
export async function assertPublicUrl(
	rawUrl: string,
	options: AssertUrlOptions = {}
): Promise<URL> {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		throw new SsrfError("Invalid URL");
	}

	const allowedProtocols = options.allowHttp
		? new Set(["http:", "https:"])
		: new Set(["https:"]);
	if (!allowedProtocols.has(url.protocol)) {
		throw new SsrfError(
			`Protocol "${url.protocol}" is not allowed for this data source`
		);
	}

	if (url.username || url.password) {
		throw new SsrfError("Credentials must not be embedded in the URL");
	}

	const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
	if (BLOCKED_HOSTNAMES.has(hostname)) {
		throw new SsrfError(`Host "${hostname}" is not allowed`);
	}

	// Literal IP host: validate directly.
	if (net.isIP(hostname)) {
		if (isPrivateAddress(hostname)) {
			throw new SsrfError(
				"Refusing to connect to a private/loopback/link-local address"
			);
		}
		return url;
	}

	// Hostname: resolve and validate every returned address.
	const lookup = options.lookup || defaultLookup;
	let addresses: { address: string }[];
	try {
		addresses = await lookup(hostname);
	} catch {
		throw new SsrfError(`Could not resolve host "${hostname}"`);
	}
	if (addresses.length === 0) {
		throw new SsrfError(`Host "${hostname}" did not resolve to any address`);
	}
	for (const { address } of addresses) {
		if (isPrivateAddress(address)) {
			throw new SsrfError(
				`Host "${hostname}" resolves to a private/loopback/link-local address`
			);
		}
	}

	return url;
}

export interface SafeFetchOptions extends AssertUrlOptions {
	method?: string;
	headers?: Record<string, string>;
	body?: string;
	/** Request timeout in ms. Default 15000. */
	timeoutMs?: number;
	/** Injectable fetch for tests. Defaults to global fetch. */
	fetchImpl?: typeof fetch;
	/** Secret values to redact from any thrown error message. */
	redactValues?: string[];
	/**
	 * When set, the fetch runs under a per-source concurrency cap keyed by this
	 * value so a rate-limited backend is never hammered by parallel widgets.
	 */
	concurrencyKey?: string;
	/** Max concurrent outbound requests per `concurrencyKey`. Default 4. */
	maxConcurrent?: number;
	/** Retry transient 429/5xx/network failures with exponential backoff. */
	retry?: RetryOptions | boolean;
}

/** Redact sensitive substrings from a message. */
export function redact(message: string, values: string[] = []): string {
	let out = message;
	for (const v of values) {
		if (v && v.length >= 4) {
			out = out.split(v).join("[REDACTED]");
		}
	}
	return out;
}

/**
 * Perform an SSRF-validated fetch with a timeout. Throws on non-2xx with a
 * redacted message. Returns the parsed JSON body (or text when not JSON).
 */
export async function safeFetch<T = unknown>(
	rawUrl: string,
	options: SafeFetchOptions = {}
): Promise<T> {
	const redactValues = options.redactValues || [];
	const url = await assertPublicUrl(rawUrl, {
		allowHttp: options.allowHttp,
		lookup: options.lookup,
	});
	const fetchImpl = options.fetchImpl || fetch;

	// Follow redirects manually so every hop is re-validated against the SSRF
	// rules. Default `fetch` follows redirects transparently, which would let a
	// vendor 3xx to an internal/loopback address bypass `assertPublicUrl`.
	const performOnce = async (target: URL) => {
		const controller = new AbortController();
		const timeout = setTimeout(
			() => controller.abort(),
			options.timeoutMs ?? 15000
		);
		try {
			return await fetchImpl(target.toString(), {
				method: options.method || "GET",
				headers: options.headers,
				body: options.body,
				signal: controller.signal,
				redirect: "manual",
			});
		} finally {
			clearTimeout(timeout);
		}
	};

	const doFetch = async (): Promise<T> => {
		let currentUrl = url;
		for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
			let response: Awaited<ReturnType<typeof fetchImpl>>;
			try {
				response = await performOnce(currentUrl);
			} catch (err) {
				if ((err as Error)?.name === "AbortError") {
					throw new Error("Data source request timed out");
				}
				throw new Error(
					redact(String((err as Error)?.message || err), redactValues)
				);
			}

			if (REDIRECT_STATUSES.has(response.status)) {
				const location = response.headers?.get?.("location");
				if (!location) {
					throw new SourceResponseError(
						response.status,
						`Data source responded ${response.status} without a Location header`
					);
				}
				let next: URL;
				try {
					next = new URL(location, currentUrl);
				} catch {
					throw new SsrfError("Data source redirected to an invalid URL");
				}
				// Re-validate the redirect target; throws SsrfError if internal.
				currentUrl = await assertPublicUrl(next.toString(), {
					allowHttp: options.allowHttp,
					lookup: options.lookup,
				});
				continue;
			}

			const text = await response.text();
			if (!response.ok) {
				throw new SourceResponseError(
					response.status,
					redact(
						`Data source responded ${response.status}: ${text.slice(0, 500)}`,
						redactValues
					)
				);
			}
			if (!text) return undefined as unknown as T;
			try {
				return JSON.parse(text) as T;
			} catch {
				return text as unknown as T;
			}
		}
		throw new SsrfError(
			"Data source exceeded the maximum number of redirects"
		);
	};

	const withRetryMaybe = options.retry
		? () =>
				withRetry(
					doFetch,
					typeof options.retry === "object" ? options.retry : {}
				)
		: doFetch;

	if (options.concurrencyKey) {
		return withSourceConcurrency(
			options.concurrencyKey,
			options.maxConcurrent ?? 4,
			withRetryMaybe
		);
	}
	return withRetryMaybe();
}
