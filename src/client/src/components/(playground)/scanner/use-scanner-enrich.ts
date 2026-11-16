"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import getMessage from "@/constants/messages";
import { getRequestHeaders } from "@/utils/api";
import type {
	ScannerEnrichParams,
	ScannerEnrichRun,
} from "@/lib/platform/connectors/scanner/types";

const POLL_INTERVAL_MS = 1000;

/** An error the server answered with; network failures carry no status. */
class EnrichRequestError extends Error {
	constructor(
		message: string,
		readonly status: number
	) {
		super(message);
	}
}

/** Network failures and server errors are worth polling through. */
function isTransient(error: unknown): boolean {
	return !(error instanceof EnrichRequestError) || error.status >= 500;
}

async function requestJson<T>(url: string, fallback: string, init: RequestInit = {}): Promise<T> {
	const response = await fetch(url, {
		...init,
		headers: getRequestHeaders(init.body ? { "Content-Type": "application/json" } : undefined),
	});
	const body = await response.json().catch(() => null);
	if (!response.ok) {
		throw new EnrichRequestError(
			typeof body === "string" ? body : body?.err || fallback,
			response.status
		);
	}
	return body as T;
}

/**
 * The latest Enrich run for one finding: loads it, polls while it runs, and
 * starts, cancels, retries or discards it through the scanner enrich API.
 */
export function useScannerEnrich({
	connectorId,
	jobId,
	alertNumber,
}: {
	connectorId?: string;
	jobId?: string;
	alertNumber?: number;
}) {
	const messages = getMessage();
	const [run, setRun] = useState<ScannerEnrichRun | null>(null);
	const [busy, setBusy] = useState(false);
	const [pollRetry, setPollRetry] = useState(0);
	const base = connectorId ? `/api/scanners/${encodeURIComponent(connectorId)}/enrich` : "";

	useEffect(() => {
		setRun(null);
		if (!base || !jobId || !alertNumber) return;
		let active = true;
		const params = new URLSearchParams({ jobId, alertNumber: String(alertNumber) });
		requestJson<{ run: ScannerEnrichRun | null }>(`${base}?${params}`, messages.SCANNER_ENRICH_LOAD_FAILED)
			.then((body) => {
				if (active) setRun(body.run);
			})
			.catch(() => undefined);
		return () => {
			active = false;
		};
	}, [alertNumber, base, jobId, messages.SCANNER_ENRICH_LOAD_FAILED]);

	useEffect(() => {
		if (!base || run?.status !== "running") return;
		let active = true;
		const timer = setTimeout(() => {
			requestJson<{ run: ScannerEnrichRun }>(
				`${base}/${encodeURIComponent(run.id)}`,
				messages.SCANNER_ENRICH_LOAD_FAILED
			)
				.then((body) => {
					if (active) setRun(body.run);
				})
				.catch((error: unknown) => {
					if (!active) return;
					if (isTransient(error)) {
						setPollRetry((count) => count + 1);
						return;
					}
					toast.error(error instanceof Error ? error.message : messages.SCANNER_ENRICH_LOAD_FAILED);
					setRun(null);
				});
		}, POLL_INTERVAL_MS);
		return () => {
			active = false;
			clearTimeout(timer);
		};
	}, [base, messages.SCANNER_ENRICH_LOAD_FAILED, pollRetry, run]);

	const perform = useCallback(
		async (action: () => Promise<void>) => {
			setBusy(true);
			try {
				await action();
			} catch (error) {
				toast.error(error instanceof Error ? error.message : messages.SCANNER_ENRICH_FAILED);
			} finally {
				setBusy(false);
			}
		},
		[messages.SCANNER_ENRICH_FAILED]
	);

	const start = useCallback(
		(params: ScannerEnrichParams) =>
			perform(async () => {
				if (!base || !jobId || !alertNumber) return;
				const body = await requestJson<{ run: ScannerEnrichRun }>(base, messages.SCANNER_ENRICH_FAILED, {
					method: "POST",
					body: JSON.stringify({ jobId, alertNumber, ...params }),
				});
				setRun(body.run);
			}),
		[alertNumber, base, jobId, messages.SCANNER_ENRICH_FAILED, perform]
	);

	const cancel = useCallback(
		() =>
			perform(async () => {
				if (!base || !run) return;
				const body = await requestJson<{ run: ScannerEnrichRun }>(
					`${base}/${encodeURIComponent(run.id)}/cancel`,
					messages.SCANNER_ENRICH_FAILED,
					{ method: "POST" }
				);
				setRun(body.run);
			}),
		[base, messages.SCANNER_ENRICH_FAILED, perform, run]
	);

	const discard = useCallback(
		() =>
			perform(async () => {
				if (!base || !run) return;
				await requestJson(`${base}/${encodeURIComponent(run.id)}`, messages.SCANNER_ENRICH_FAILED, {
					method: "DELETE",
				});
				setRun(null);
			}),
		[base, messages.SCANNER_ENRICH_FAILED, perform, run]
	);

	const retry = useCallback(() => {
		if (!run) return Promise.resolve();
		return start({
			provider: run.provider,
			model: run.model,
			attempts: run.attempts,
			recheck: run.recheck,
			baseRef: run.baseRef,
		});
	}, [run, start]);

	return { run, busy, start, cancel, discard, retry };
}
