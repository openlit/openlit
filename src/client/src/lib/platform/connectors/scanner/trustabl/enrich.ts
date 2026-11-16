/**
 * Trustabl Enrich pipeline for one finding.
 *
 * clone → locate the finding in a fresh scan → `trustabl enrich --apply` on a
 * one-finding ScanResult → re-check the rule → diff for review. Everything
 * happens in a temp working copy that is removed afterwards; nothing is
 * pushed. Commands run with paths relative to the copy's root, an isolated
 * HOME, and only the selected provider's key.
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	SCANNER_ENRICH_CANCELLED,
	SCANNER_ENRICH_MODEL_DEFAULT,
	SCANNER_ENRICH_NOT_APPLIED,
	SCANNER_ENRICH_NOT_DETECTED,
	SCANNER_ENRICH_PROVIDER_FAILED,
	SCANNER_ENRICH_STEP_NOTHING_PUSHED,
	SCANNER_ENRICH_STEP_RECHECK_DETAIL,
	SCANNER_ENRICH_STEP_RESOLVED,
	SCANNER_ENRICH_STEP_STILL_DETECTED,
	SCANNER_ENRICH_STILL_DETECTED,
	SCANNER_ENRICH_TIMED_OUT,
	SCANNER_SCAN_FAILED,
} from "@/constants/messages/en";
import type { ScannerCliSchema } from "../cli-schema";
import {
	compareRecheck,
	diffStats,
	locateRawFinding,
	parseEnrichOutput,
	redactEnrichText,
	scannerFindingKey,
	singleFindingReport,
} from "../enrich-result";
import { ENRICH_RUN_TIMEOUT_MS, scannerEnrichProviderEnvKey } from "../enrich-params";
import { createEnrichWorkspace, removeEnrichWorkspace, resolveInsideWorkspace } from "../enrich-workspace";
import { getScannerProcessRunner } from "../process";
import { formatScannerError } from "../report";
import { buildScannerScanArgv } from "../scan-params";
import { normalizeScannerDetectors } from "../target";
import type {
	ScannerEnrichFailure,
	ScannerEnrichProvider,
	ScannerEnrichRequest,
	ScannerEnrichRun,
	ScannerEnrichStep,
	ScannerEnrichStepKey,
} from "../types";

const MAX_LOG_LINES = 200;
const REPO_DIR = "repo";
const PASSTHROUGH_ENV = [
	"PATH",
	"HTTPS_PROXY",
	"HTTP_PROXY",
	"NO_PROXY",
	"https_proxy",
	"http_proxy",
	"no_proxy",
	"SSL_CERT_FILE",
	"SSL_CERT_DIR",
];

/** Minimal env for Trustabl: no host secrets, one provider key at most. */
export function buildTrustablEnrichEnv(input: {
	home: string;
	provider?: ScannerEnrichProvider;
	key?: string;
	model?: string;
}): NodeJS.ProcessEnv {
	const env: Record<string, string> = {};
	for (const name of PASSTHROUGH_ENV) {
		const value = process.env[name];
		if (value) env[name] = value;
	}
	env.HOME = input.home;
	env.NO_COLOR = "1";
	env.TRUSTABL_TELEMETRY = "off";
	if (input.provider && input.key) env[scannerEnrichProviderEnvKey(input.provider)] = input.key;
	if (input.model) env.TRUSTABL_LLM_MODEL = input.model;
	return env as NodeJS.ProcessEnv;
}

class EnrichFailure extends Error {
	constructor(
		readonly failure: ScannerEnrichFailure,
		message: string
	) {
		super(message);
	}
}

function isAbort(error: unknown): boolean {
	return error instanceof Error && error.name === "AbortError";
}

function location(path: string | undefined, line?: number, endLine?: number): string {
	if (!line) return path || "";
	return `${path}:${line}${endLine && endLine !== line ? `-${endLine}` : ""}`;
}

export async function runTrustablEnrich(
	request: ScannerEnrichRequest,
	deps: { bin: string; schema?: ScannerCliSchema }
): Promise<Partial<ScannerEnrichRun>> {
	const { finding, params, signal } = request;
	const started = Date.now();
	const deadline = started + ENRICH_RUN_TIMEOUT_MS;
	const steps: ScannerEnrichStep[] = (["clone", "enrich", "recheck", "diff"] as ScannerEnrichStepKey[]).map(
		(key) => ({ key, status: key === "clone" ? "running" : "pending" })
	);
	const state: Partial<ScannerEnrichRun> = { steps, attempt: 0, log: [] };
	// Known key shapes are caught by pattern; the run's own key is removed by value.
	const redact = (text: string) =>
		redactEnrichText(request.providerKey ? text.split(request.providerKey).join("[redacted]") : text);
	const log = (line: string) => {
		const lines = state.log as string[];
		lines.push(redact(line));
		if (lines.length > MAX_LOG_LINES) lines.splice(0, lines.length - MAX_LOG_LINES);
	};
	const step = (key: ScannerEnrichStepKey) => steps.find((item) => item.key === key) as ScannerEnrichStep;
	const report = () => request.onProgress({ ...state, steps: steps.map((item) => ({ ...item })), log: [...(state.log || [])] });
	const finish = (fields: Partial<ScannerEnrichRun>): Partial<ScannerEnrichRun> => {
		for (const item of steps) {
			if (item.status === "pending") item.status = "skipped";
		}
		const finishedAt = Date.now();
		return {
			...state,
			...fields,
			steps,
			finishedAt: new Date(finishedAt).toISOString(),
			durationMs: finishedAt - started,
		};
	};

	const run = async (argv: string[], env: NodeJS.ProcessEnv, cwd: string) =>
		getScannerProcessRunner().run({
			bin: deps.bin,
			argv,
			env,
			cwd,
			timeoutMs: Math.max(1_000, deadline - Date.now()),
			signal,
		});

	let root = "";
	try {
		await report();
		const workspace = await createEnrichWorkspace({
			target: request.target,
			ref: params.baseRef,
			token: request.githubToken,
			signal,
		});
		root = workspace.root;
		state.commitSha = workspace.commitSha;
		const refLabel = params.baseRef || workspace.ref;
		Object.assign(step("clone"), {
			status: "done",
			detail: `${refLabel} @ ${workspace.commitSha.slice(0, 7)}`,
			durationMs: workspace.durationMs,
		});

		const home = join(root, "home");
		await mkdir(home);
		const scanEnv = buildTrustablEnrichEnv({ home });
		const enrichEnv = buildTrustablEnrichEnv({
			home,
			provider: params.provider,
			key: request.providerKey,
			model: params.model,
		});
		let detectors: string | undefined;
		try {
			detectors = normalizeScannerDetectors(finding.category);
		} catch {
			detectors = undefined;
		}
		const scanArgv = buildScannerScanArgv(REPO_DIR, { ...request.rules, detectors }, deps.schema);
		const scanCopy = async () => {
			log(`$ trustabl ${scanArgv.join(" ")}`);
			const result = await run(scanArgv, scanEnv, root);
			if (result.exitCode >= 2) {
				throw new EnrichFailure("error", formatScannerError(result.stderr || SCANNER_SCAN_FAILED));
			}
			try {
				const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
				const count = Array.isArray(parsed.findings) ? parsed.findings.length : 0;
				log(`${count} findings`);
				return parsed;
			} catch {
				throw new EnrichFailure("error", SCANNER_SCAN_FAILED);
			}
		};

		const enrichStep = step("enrich");
		enrichStep.status = "running";
		enrichStep.detail = [
			params.provider,
			params.model || SCANNER_ENRICH_MODEL_DEFAULT,
			location(finding.path, finding.line, finding.endLine),
		].join(" · ");
		await report();

		const before = await scanCopy();
		const row = locateRawFinding(before, finding);
		if (!row) throw new EnrichFailure("not-found", SCANNER_ENRICH_NOT_DETECTED(refLabel));
		const file = await resolveInsideWorkspace(workspace.repoDir, String(row.file_path || ""));
		const original = await readFile(file);
		const inputName = `finding-${request.alertNumber}.json`;
		await writeFile(join(root, inputName), JSON.stringify(singleFindingReport(before, row)));
		const enrichArgv = ["enrich", "--input", inputName, "--repo", REPO_DIR, "--apply", "--diff"];
		const key = scannerFindingKey(finding);
		const rowLocation = location(String(row.file_path), Number(row.start_line), Number(row.end_line));

		let failure: EnrichFailure = new EnrichFailure("not-applied", SCANNER_ENRICH_NOT_APPLIED);
		for (let attempt = 1; attempt <= params.attempts; attempt += 1) {
			state.attempt = attempt;
			if (attempt > 1) {
				await writeFile(file, original);
				Object.assign(enrichStep, { status: "running" });
				Object.assign(step("recheck"), { status: "pending", detail: undefined });
				await report();
			}
			log(`$ trustabl ${enrichArgv.join(" ")}`);
			await report();
			const attemptStarted = Date.now();
			const result = await run(enrichArgv, enrichEnv, root);
			for (const line of result.stderr.split("\n").filter((item) => item.trim())) log(line);
			const output = parseEnrichOutput(result.stdout, result.stderr);
			await rm(`${file}.trustabl.bak`, { force: true });
			if (!output.enriched) {
				throw new EnrichFailure(
					"provider",
					output.providerError ? redact(output.providerError) : SCANNER_ENRICH_PROVIDER_FAILED
				);
			}
			if (!output.applied || !output.diff) {
				failure = new EnrichFailure("not-applied", SCANNER_ENRICH_NOT_APPLIED);
				continue;
			}
			Object.assign(enrichStep, { status: "done", durationMs: Date.now() - attemptStarted });
			const fix = {
				partialDiff: undefined,
				explanation: output.explanation,
				fixSummary: output.fixSummary,
				...diffStats(output.diff),
			};

			const recheck = step("recheck");
			if (!params.recheck) {
				recheck.status = "skipped";
				Object.assign(step("diff"), { status: "done", detail: SCANNER_ENRICH_STEP_NOTHING_PUSHED });
				return finish({ status: "succeeded", diff: output.diff, ...fix });
			}
			Object.assign(recheck, {
				status: "running",
				detail: SCANNER_ENRICH_STEP_RECHECK_DETAIL(detectors || "all"),
			});
			await report();
			const recheckStarted = Date.now();
			const comparison = compareRecheck(before, await scanCopy(), key);
			recheck.durationMs = Date.now() - recheckStarted;
			if (comparison.resolved) {
				recheck.status = "done";
				recheck.detail = SCANNER_ENRICH_STEP_RESOLVED;
				Object.assign(step("diff"), { status: "done", detail: SCANNER_ENRICH_STEP_NOTHING_PUSHED });
				return finish({ status: "succeeded", diff: output.diff, ...fix, ...comparison });
			}
			recheck.status = "failed";
			recheck.detail = SCANNER_ENRICH_STEP_STILL_DETECTED(rowLocation);
			state.partialDiff = output.diff;
			state.explanation = output.explanation;
			failure = new EnrichFailure(
				"still-detected",
				SCANNER_ENRICH_STILL_DETECTED(finding.ruleId, params.attempts)
			);
		}
		if (failure.failure === "not-applied") enrichStep.status = "failed";
		return finish({ status: "failed", failure: failure.failure, error: failure.message });
	} catch (error) {
		const current = steps.find((item) => item.status === "running");
		if (current) current.status = "failed";
		if (isAbort(error) || signal.aborted) {
			const timedOut = (signal.reason as Error | undefined)?.name === "TimeoutError";
			return timedOut
				? finish({ status: "failed", failure: "error", error: SCANNER_ENRICH_TIMED_OUT })
				: finish({ status: "cancelled", error: SCANNER_ENRICH_CANCELLED });
		}
		if (error instanceof EnrichFailure) {
			return finish({ status: "failed", failure: error.failure, error: error.message });
		}
		const message = redact(
			formatScannerError(error instanceof Error ? error.message : SCANNER_SCAN_FAILED)
		);
		return finish({
			status: "failed",
			failure: current?.key === "clone" ? "clone" : "error",
			error: message,
		});
	} finally {
		if (root) await removeEnrichWorkspace(root);
	}
}
