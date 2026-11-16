/**
 * Project-scoped Enrich runs for scanner connectors.
 *
 * A run is validated, given its Vault key and connector token inside the
 * request (session and database config come from the request), recorded as
 * running, and then executed in the background by the connector's adapter.
 * Progress lands in connector metadata, which the UI polls. Keys and tokens
 * are only ever held in memory for the duration of the run.
 */

import { randomUUID } from "crypto";
import {
	SCANNER_ENRICH_CANCELLED,
	SCANNER_ENRICH_FAILED,
	SCANNER_ENRICH_FINDING_NOT_FOUND,
	SCANNER_ENRICH_NO_LOCATION,
	SCANNER_ENRICH_RUN_NOT_FOUND,
	SCANNER_ENRICH_RUNNING,
	SCANNER_ENRICH_TIMED_OUT,
	SCANNER_JOB_NOT_FOUND,
	SCANNER_RUNTIME_NOT_INSTALLED,
} from "@/constants/messages/en";
import { resolveSourceSecret } from "../datasource/http/secret";
import { getScannerConnector, getScannerRuntime } from "./crud";
import { ENRICH_RUN_TIMEOUT_MS } from "./enrich-params";
import { listScannerEnrichProviders, resolveScannerEnrichProviderKey } from "./enrich-providers";
import { scannerFindingKey } from "./enrich-result";
import {
	enrichRunsFromMetadata,
	removeScannerEnrichRun,
	settleStaleEnrichRun,
	upsertScannerEnrichRun,
} from "./enrich-runs";
import { jobsFromMetadata } from "./jobs";
import { probeTrustablRuntime } from "./runtime";
import {
	UnsupportedScannerCapabilityError,
	type ScannerEnrichInput,
	type ScannerEnrichRun,
	type ScannerFinding,
	type ScannerJob,
} from "./types";

const activeRuns = new Map<string, AbortController>();
/** Connectors whose start is past the one-run check but not yet registered. */
const startingConnectors = new Set<string>();

export function __resetScannerEnrichRegistryForTests(): void {
	for (const controller of Array.from(activeRuns.values())) controller.abort();
	activeRuns.clear();
	startingConnectors.clear();
}

function settle(run: ScannerEnrichRun): ScannerEnrichRun {
	return settleStaleEnrichRun(run, activeRuns.has(run.id));
}

async function findRun(id: string, runId: string) {
	const row = await getScannerConnector(id);
	const run = enrichRunsFromMetadata(row.metadata || "{}").find((item) => item.id === runId);
	if (!run) throw new Error(SCANNER_ENRICH_RUN_NOT_FOUND);
	return { row, run };
}

export async function listScannerEnrichProvidersFor(id: string) {
	await getScannerConnector(id);
	return listScannerEnrichProviders();
}

export async function startScannerEnrich(
	id: string,
	input: ScannerEnrichInput
): Promise<ScannerEnrichRun> {
	const { adapter, row } = await getScannerRuntime(id);
	if (!adapter.capabilities().enrich) {
		throw new UnsupportedScannerCapabilityError(row.type, "enrich");
	}
	const job = jobsFromMetadata(row.metadata || "{}").find((item) => item.id === input.jobId);
	if (!job) throw new Error(SCANNER_JOB_NOT_FOUND);
	const finding = job.findings?.[input.alertNumber - 1];
	if (!finding) throw new Error(SCANNER_ENRICH_FINDING_NOT_FOUND);
	if (!finding.path || !finding.line) throw new Error(SCANNER_ENRICH_NO_LOCATION);
	if (
		startingConnectors.has(row.id) ||
		enrichRunsFromMetadata(row.metadata || "{}").some((run) => activeRuns.has(run.id))
	) {
		throw new Error(SCANNER_ENRICH_RUNNING);
	}
	// Reserve the connector before the first await so a concurrent start is refused.
	startingConnectors.add(row.id);
	try {
		return await launchScannerEnrich(row, adapter, job, finding, input);
	} finally {
		startingConnectors.delete(row.id);
	}
}

async function launchScannerEnrich(
	row: Awaited<ReturnType<typeof getScannerRuntime>>["row"],
	adapter: Awaited<ReturnType<typeof getScannerRuntime>>["adapter"],
	job: ScannerJob,
	finding: ScannerFinding,
	input: ScannerEnrichInput
): Promise<ScannerEnrichRun> {
	const runtime = await probeTrustablRuntime();
	if (!runtime.installed) throw new Error(SCANNER_RUNTIME_NOT_INSTALLED);

	const providerKey = await resolveScannerEnrichProviderKey(input.provider);
	const secret = await resolveSourceSecret(row.secretRef, undefined, row.projectId, {
		clickHouseVault: false,
	});
	const githubToken = secret.credentials.githubToken || secret.credentials.token || undefined;

	let run: ScannerEnrichRun = {
		id: `enrich:${randomUUID()}`,
		status: "running",
		jobId: job.id,
		alertNumber: input.alertNumber,
		findingKey: scannerFindingKey(finding),
		ruleId: finding.ruleId,
		path: finding.path,
		line: finding.line,
		endLine: finding.endLine,
		target: job.target,
		baseRef: input.baseRef,
		provider: input.provider,
		model: input.model,
		attempts: input.attempts,
		attempt: 0,
		recheck: input.recheck,
		steps: [
			{ key: "clone", status: "running" },
			{ key: "enrich", status: "pending" },
			{ key: "recheck", status: "pending" },
			{ key: "diff", status: "pending" },
		],
		startedAt: new Date().toISOString(),
	};
	const controller = new AbortController();
	activeRuns.set(run.id, controller);
	try {
		await upsertScannerEnrichRun(row.id, run);
	} catch (error) {
		activeRuns.delete(run.id);
		throw error;
	}
	const started = run;
	const timeout = setTimeout(
		() => controller.abort(Object.assign(new Error(SCANNER_ENRICH_TIMED_OUT), { name: "TimeoutError" })),
		ENRICH_RUN_TIMEOUT_MS
	);

	void (async () => {
		try {
			const result = await adapter.enrich({
				runId: run.id,
				finding,
				alertNumber: input.alertNumber,
				target: job.target,
				params: {
					provider: input.provider,
					model: input.model,
					attempts: input.attempts,
					recheck: input.recheck,
					baseRef: input.baseRef,
				},
				providerKey,
				githubToken,
				rules: {
					rulesRepo: job.params?.rulesRepo,
					rulesRef: job.params?.rulesRef,
					rulesSource: job.params?.rulesSource,
					requireSigned: job.params?.requireSigned,
				},
				signal: controller.signal,
				onProgress: async (patch) => {
					run = { ...run, ...patch, status: "running" };
					await upsertScannerEnrichRun(row.id, run);
				},
			});
			run = { ...run, ...result };
		} catch (error) {
			run = {
				...run,
				status: "failed",
				failure: "error",
				error: error instanceof Error ? error.message : SCANNER_ENRICH_FAILED,
				finishedAt: new Date().toISOString(),
			};
		} finally {
			clearTimeout(timeout);
			activeRuns.delete(run.id);
			await upsertScannerEnrichRun(row.id, run).catch(() => undefined);
		}
	})();

	return started;
}

export async function getScannerEnrichRun(id: string, runId: string): Promise<ScannerEnrichRun> {
	const { run } = await findRun(id, runId);
	return settle(run);
}

export async function latestScannerEnrichRun(
	id: string,
	jobId: string,
	alertNumber: number
): Promise<ScannerEnrichRun | null> {
	const row = await getScannerConnector(id);
	const run = enrichRunsFromMetadata(row.metadata || "{}").find(
		(item) => item.jobId === jobId && item.alertNumber === alertNumber
	);
	return run ? settle(run) : null;
}

export async function cancelScannerEnrich(id: string, runId: string): Promise<ScannerEnrichRun> {
	const { row, run } = await findRun(id, runId);
	const controller = activeRuns.get(run.id);
	if (controller) {
		controller.abort();
		return run;
	}
	if (run.status !== "running") return settle(run);
	const cancelled: ScannerEnrichRun = {
		...run,
		status: "cancelled",
		error: SCANNER_ENRICH_CANCELLED,
		finishedAt: new Date().toISOString(),
	};
	await upsertScannerEnrichRun(row.id, cancelled);
	return cancelled;
}

export async function discardScannerEnrich(id: string, runId: string): Promise<{ ok: true }> {
	const { row, run } = await findRun(id, runId);
	if (activeRuns.has(run.id)) throw new Error(SCANNER_ENRICH_RUNNING);
	await removeScannerEnrichRun(row.id, run.id);
	return { ok: true };
}
