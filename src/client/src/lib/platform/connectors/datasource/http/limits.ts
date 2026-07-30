/**
 * Backend pull hardening for external telemetry sources (Grafana-inspired).
 *
 * External observability backends rate-limit hard and have per-query scan
 * ceilings, so every outbound pull should:
 *   - stay under a per-source concurrency cap (a semaphore keyed by source id),
 *   - retry transient failures (429 / 5xx / network) with exponential backoff,
 *   - respect query budgets (max rows, max time range) so a widget can never
 *     ask a vendor for an unbounded scan.
 *
 * These are pure, injectable utilities so they are unit-testable without real
 * network access.
 */

import type { OpenLITQuery } from "../types";

// ---- Query budgets --------------------------------------------------------

export interface QueryBudget {
	/** Hard cap on returned rows. */
	maxRows: number;
	/** Hard cap on the query time range (ms). */
	maxRangeMs: number;
	/**
	 * Hard cap on how far back `start` may reach from `end` (ms). Sourced from a
	 * source's `capabilities().maxLookbackMs` (e.g. a vendor's retention window)
	 * so we never ask for data older than the vendor keeps.
	 */
	maxLookbackMs?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Conservative default budget applied to external structured queries. */
export const DEFAULT_QUERY_BUDGET: QueryBudget = {
	maxRows: 5000,
	maxRangeMs: 30 * DAY_MS,
};

/**
 * Clamp an OpenLITQuery to a budget. Returns the (possibly) clamped query and
 * the list of fields that were clamped so callers can surface a truncation
 * note. The time range is clamped by moving `start` forward toward `end`.
 */
export function clampQueryBudget(
	query: OpenLITQuery,
	budget: QueryBudget = DEFAULT_QUERY_BUDGET
): { query: OpenLITQuery; clamped: string[] } {
	const clamped: string[] = [];
	const next: OpenLITQuery = { ...query };

	if (next.limit === undefined || next.limit > budget.maxRows) {
		if (next.limit !== undefined && next.limit > budget.maxRows) {
			clamped.push("limit");
		}
		next.limit = Math.min(next.limit ?? budget.maxRows, budget.maxRows);
	}

	const { start, end } = next.timeRange;
	// Effective range ceiling is the tighter of the absolute range cap and the
	// vendor lookback/retention window.
	const effectiveMaxRangeMs =
		budget.maxLookbackMs !== undefined
			? Math.min(budget.maxRangeMs, budget.maxLookbackMs)
			: budget.maxRangeMs;
	const rangeMs = end.getTime() - start.getTime();
	if (rangeMs > effectiveMaxRangeMs) {
		next.timeRange = {
			start: new Date(end.getTime() - effectiveMaxRangeMs),
			end,
		};
		clamped.push(
			rangeMs > budget.maxRangeMs ? "timeRange" : "maxLookback"
		);
	}

	return { query: next, clamped };
}

// ---- Per-source concurrency cap ------------------------------------------

/** A minimal FIFO counting semaphore. */
export class Semaphore {
	private readonly max: number;
	private active = 0;
	private readonly queue: (() => void)[] = [];

	constructor(max: number) {
		this.max = Math.max(1, max);
	}

	async acquire(): Promise<() => void> {
		if (this.active < this.max) {
			this.active++;
			return () => this.release();
		}
		await new Promise<void>((resolve) => this.queue.push(resolve));
		this.active++;
		return () => this.release();
	}

	private release(): void {
		this.active--;
		const next = this.queue.shift();
		if (next) next();
	}
}

const semaphores = new Map<string, Semaphore>();

/** Run `fn` under a per-key concurrency cap (default cap is created lazily). */
export async function withSourceConcurrency<T>(
	key: string,
	maxConcurrent: number,
	fn: () => Promise<T>
): Promise<T> {
	let sem = semaphores.get(key);
	if (!sem) {
		sem = new Semaphore(maxConcurrent);
		semaphores.set(key, sem);
	}
	const release = await sem.acquire();
	try {
		return await fn();
	} finally {
		release();
	}
}

/** Test-only: reset the semaphore registry. */
export function __resetConcurrencyForTests(): void {
	semaphores.clear();
}

// ---- Retry with exponential backoff --------------------------------------

export interface RetryOptions {
	/** Number of retry attempts after the first try. Default 2. */
	retries?: number;
	/** Base delay in ms; grows exponentially. Default 200. */
	baseDelayMs?: number;
	/** Whether an error is retryable. Default: 429 / 5xx / network. */
	isRetryable?: (err: unknown) => boolean;
	/** Injectable sleep for tests. */
	sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Default retryability: transient HTTP (429/5xx) or network/timeout errors. */
export function defaultIsRetryable(err: unknown): boolean {
	const status = (err as { status?: number })?.status;
	if (typeof status === "number") return status === 429 || status >= 500;
	const message = String((err as Error)?.message || "").toLowerCase();
	return (
		message.includes("timed out") ||
		message.includes("network") ||
		message.includes("econn") ||
		message.includes("fetch failed")
	);
}

/** Run `fn`, retrying transient failures with exponential backoff. */
export async function withRetry<T>(
	fn: () => Promise<T>,
	options: RetryOptions = {}
): Promise<T> {
	const retries = options.retries ?? 2;
	const baseDelayMs = options.baseDelayMs ?? 200;
	const isRetryable = options.isRetryable ?? defaultIsRetryable;
	const sleep = options.sleep ?? defaultSleep;

	let lastErr: unknown;
	for (let attempt = 0; attempt <= retries; attempt++) {
		try {
			return await fn();
		} catch (err) {
			lastErr = err;
			if (attempt === retries || !isRetryable(err)) break;
			await sleep(baseDelayMs * Math.pow(2, attempt));
		}
	}
	throw lastErr;
}
