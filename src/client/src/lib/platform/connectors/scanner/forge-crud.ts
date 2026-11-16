/**
 * Project-scoped Trustabl Forge runs for scanner connectors.
 *
 * Forge needs policy ids, not a checkout. When the caller sends none, the
 * policies come from the latest Analyzer scan of the same repository.
 */

import { getScannerConnector, getScannerRuntime, parseScannerSettings } from "./crud";
import { resolveScannerForgeParams } from "./forge-params";
import { FALLBACK_FORGE_POLICIES, forgePoliciesFromJob, latestAnalyzerJobForRepo } from "./forge-policies";
import {
	forgeRunsFromMetadata,
	hasRunningForgeRun,
	isScannerForgeRunId,
	newScannerForgeRunId,
	prependScannerForgeRun,
	summarizeForgeRun,
} from "./forge-runs";
import { jobsFromMetadata } from "./jobs";
import { probeTrustablRuntime } from "./runtime";
import { normalizeScannerTarget, scannerCloneTarget } from "./target";
import type {
	ScannerForgeCheck,
	ScannerForgePolicySource,
	ScannerForgeRun,
	ScannerForgeRunInput,
} from "./types";
import {
	SCANNER_FORGE_FAILED,
	SCANNER_FORGE_POLICIES_REQUIRED,
	SCANNER_FORGE_RUN_ID_INVALID,
	SCANNER_FORGE_RUN_NO_CONTENT,
	SCANNER_FORGE_RUN_NOT_FOUND,
	SCANNER_FORGE_RUNNING,
	SCANNER_FORGE_UNSUPPORTED,
} from "@/constants/messages/en";

async function acceptedForgePolicies(): Promise<string[]> {
	try {
		const runtime = await probeTrustablRuntime();
		return runtime.forge?.policies.length ? runtime.forge.policies : FALLBACK_FORGE_POLICIES;
	} catch {
		return FALLBACK_FORGE_POLICIES;
	}
}

export async function runScannerForge(id: string, input: ScannerForgeRunInput = {}) {
	const { adapter, connector, row } = await getScannerRuntime(id);
	if (!adapter.forge) throw new Error(SCANNER_FORGE_UNSUPPORTED);
	if (hasRunningForgeRun(row.metadata || "{}")) throw new Error(SCANNER_FORGE_RUNNING);

	const settings = parseScannerSettings(row.settings);
	const target = scannerCloneTarget(normalizeScannerTarget(input.target || settings.target));
	const params = resolveScannerForgeParams(input);
	const jobs = jobsFromMetadata(row.metadata || "{}");
	let policySource: ScannerForgePolicySource = { kind: "manual" };
	if (params.policies.length) {
		const source = input.sourceJobId
			? jobs.find((job) => job.id === input.sourceJobId)
			: undefined;
		if (source) policySource = { kind: "analyzer", jobId: source.id, scannedAt: source.startedAt };
	} else {
		const latest = latestAnalyzerJobForRepo(jobs, target);
		params.policies = forgePoliciesFromJob(latest, await acceptedForgePolicies());
		if (latest && params.policies.length) {
			policySource = { kind: "analyzer", jobId: latest.id, scannedAt: latest.startedAt };
		}
	}
	if (!params.policies.length) throw new Error(SCANNER_FORGE_POLICIES_REQUIRED);

	const running: ScannerForgeRun = {
		id: newScannerForgeRunId(),
		status: "running",
		target,
		...params,
		policySource,
		startedAt: new Date().toISOString(),
	};
	await prependScannerForgeRun(row.id, running);
	try {
		const result = await adapter.forge({ ...params, target, policySource });
		const run: ScannerForgeRun = { ...result, id: running.id };
		await prependScannerForgeRun(row.id, run);
		return { connector, run: summarizeForgeRun(run) };
	} catch (error) {
		const failed: ScannerForgeRun = {
			...running,
			status: "failed",
			finishedAt: new Date().toISOString(),
			error: error instanceof Error ? error.message : SCANNER_FORGE_FAILED,
		};
		await prependScannerForgeRun(row.id, failed);
		throw error;
	}
}

export async function getScannerForgeRun(id: string, runId: string): Promise<ScannerForgeRun> {
	if (!isScannerForgeRunId(runId)) throw new Error(SCANNER_FORGE_RUN_ID_INVALID);
	const row = await getScannerConnector(id);
	const run = forgeRunsFromMetadata(row.metadata || "{}").find((item) => item.id === runId);
	if (!run) throw new Error(SCANNER_FORGE_RUN_NOT_FOUND);
	return run;
}

export async function checkScannerForgeRun(id: string, runId: string): Promise<ScannerForgeCheck> {
	const run = await getScannerForgeRun(id, runId);
	if (!run.content) throw new Error(SCANNER_FORGE_RUN_NO_CONTENT);
	const { adapter } = await getScannerRuntime(id);
	if (!adapter.checkForge) throw new Error(SCANNER_FORGE_UNSUPPORTED);
	return adapter.checkForge(run.content, run.rulesRef);
}
