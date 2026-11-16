import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import getMessage from "@/constants/messages";
import type { ConnectorHealthResult } from "../../types";
import { resolveSourceSecret } from "../../datasource/http/secret";
import { BaseScannerAdapter } from "../base-adapter";
import { trustablConfigFields } from "../config-fields";
import { getScannerProcessRunner } from "../process";
import { newScannerJobId, parseScannerReport, formatScannerError } from "../report";
import { TRUSTABL_PINNED_VERSION, probeTrustablRuntime, resolveTrustablBinary, scannerCliVersionLabel } from "../runtime";
import { describeTrustablRuntime, installTrustablCli } from "../install";
import type { ScannerCliSchema } from "../cli-schema";
import { buildScannerForgeArgv, forgeCommandPreview } from "../forge-params";
import { newScannerForgeRunId } from "../forge-runs";
import { parseForgeCheckOutput, parseForgeSkill } from "../forge-skill";
import { compactScannerScanParams, resolveScannerScanParams, buildScannerScanArgv } from "../scan-params";
import {
	normalizeScannerRef,
	normalizeScannerTarget,
	scannerCloneTarget,
	scannerRefFromTarget,
} from "../target";
import type {
	ScannerAdapterFactory,
	ScannerCapabilities,
	ScannerForgeAdapterInput,
	ScannerForgeCheck,
	ScannerForgeRun,
	ScannerJob,
	ScannerRuntimeInfo,
	ScannerScanInput,
	ScannerScanParams,
	ScannerSourceDescriptor,
	ScannerTypeDescriptor,
} from "../types";
import {
	SCANNER_FORGE_EMPTY_OUTPUT,
	SCANNER_FORGE_FAILED,
	SCANNER_FORGE_OUTPUT_TOO_LARGE,
	SCANNER_FORGE_POLICY_UNKNOWN,
	SCANNER_FORGE_UNSUPPORTED,
	SCANNER_RUNTIME_NOT_INSTALLED,
	SCANNER_SCAN_FAILED,
} from "@/constants/messages/en";

const TRUSTABL_CAPABILITIES: ScannerCapabilities = {
	install: true,
	scan: true,
	listFindings: true,
	forge: true,
};

const SCAN_TIMEOUT_MS = 8 * 60 * 1000;
const FORGE_TIMEOUT_MS = 2 * 60 * 1000;
const FORGE_CHECK_TIMEOUT_MS = 60 * 1000;
const FORGE_MAX_BYTES = 512 * 1024;
const FORGE_CHECK_FILE = "SKILL.md";

/**
 * Forge reads SDK manifests from its working directory. Give every run an
 * empty one so only the requested policies count and no host path is read.
 */
async function withEmptyForgeDir<T>(run: (cwd: string) => Promise<T>): Promise<T> {
	const cwd = await mkdtemp(join(tmpdir(), "openlit-forge-"));
	try {
		return await run(cwd);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
}

function forgeEnv(): NodeJS.ProcessEnv {
	return { ...process.env, NO_COLOR: "1" };
}

export function buildTrustablScanArgv(
	target: string,
	params: ScannerScanParams,
	schema?: ScannerCliSchema
): string[] {
	return buildScannerScanArgv(target, params, schema);
}

export class TrustablAdapter extends BaseScannerAdapter {
	readonly type = "trustabl";

	capabilities(): ScannerCapabilities {
		return TRUSTABL_CAPABILITIES;
	}

	async healthCheck(): Promise<ConnectorHealthResult> {
		const started = Date.now();
		try {
			const runtime = await describeTrustablRuntime();
			return {
				ok: runtime.installed,
				message: runtime.installed
					? runtime.version
					: SCANNER_RUNTIME_NOT_INSTALLED,
				latencyMs: Date.now() - started,
			};
		} catch (error) {
			return {
				ok: false,
				message: error instanceof Error ? error.message : SCANNER_RUNTIME_NOT_INSTALLED,
				latencyMs: Date.now() - started,
			};
		}
	}

	async ensureRuntime(input: { upgrade?: boolean } = {}): Promise<ScannerRuntimeInfo> {
		return installTrustablCli(input);
	}

	async scan(input: ScannerScanInput = {}): Promise<ScannerJob> {
		const startedAt = new Date();
		const jobId = newScannerJobId();
		const target = normalizeScannerTarget(input.target || this.descriptor.settings.target);
		const cloneTarget = scannerCloneTarget(target);
		const ref =
			normalizeScannerRef(input.ref ?? this.descriptor.settings.ref) ||
			scannerRefFromTarget(target);
		const params = resolveScannerScanParams(
			input,
			this.descriptor.settings,
			this.descriptor.environment
		);
		const persistedParams = compactScannerScanParams(params);

		const runtime = await probeTrustablRuntime();
		const cliVersion = scannerCliVersionLabel(runtime);
		const argv = buildTrustablScanArgv(cloneTarget, params, runtime.schema);
		const resolved = runtime.installed ? await resolveTrustablBinary() : null;
		if (!runtime.installed || !resolved) {
			return {
				id: jobId,
				status: "runtime-missing",
				target: cloneTarget,
				ref,
				params: persistedParams,
				cliVersion,
				startedAt: startedAt.toISOString(),
				finishedAt: new Date().toISOString(),
				error: SCANNER_RUNTIME_NOT_INSTALLED,
			};
		}

		const secret = await resolveSourceSecret(
			this.descriptor.secretRef,
			undefined,
			this.descriptor.projectId,
			{ clickHouseVault: false }
		);
		const token = secret.credentials.githubToken || secret.credentials.token || "";
		const env: NodeJS.ProcessEnv = {
			...process.env,
			NO_COLOR: "1",
		};
		if (token) {
			env.GITHUB_TOKEN = token;
			env.GH_TOKEN = token;
		}

		let result;
		try {
			result = await getScannerProcessRunner().run({
				bin: resolved.bin,
				argv,
				env,
				timeoutMs: SCAN_TIMEOUT_MS,
			});
		} catch (error) {
			const finishedAt = new Date();
			return {
				id: jobId,
				status: "failed",
				target: cloneTarget,
				ref,
				params: persistedParams,
				cliVersion,
				startedAt: startedAt.toISOString(),
				finishedAt: finishedAt.toISOString(),
				durationMs: finishedAt.getTime() - startedAt.getTime(),
				error: formatScannerError(
					error instanceof Error ? error.message : SCANNER_SCAN_FAILED
				),
			};
		}

		const parsed = parseScannerReport(result.stdout);
		const finishedAt = new Date();
		const failed = result.exitCode >= 2;
		return {
			id: jobId,
			status: failed ? "failed" : "succeeded",
			target: cloneTarget,
			ref,
			params: persistedParams,
			startedAt: startedAt.toISOString(),
			finishedAt: finishedAt.toISOString(),
			durationMs: finishedAt.getTime() - startedAt.getTime(),
			exitCode: result.exitCode,
			error: failed
				? formatScannerError(result.stderr || SCANNER_SCAN_FAILED)
				: undefined,
			findingCount: parsed.findings.length,
			mediumPlusCount: parsed.mediumPlusCount,
			findings: parsed.findings,
			report: parsed.report,
			cliVersion,
		};
	}

	async forge(input: ScannerForgeAdapterInput): Promise<ScannerForgeRun> {
		const startedAt = new Date();
		const runtime = await probeTrustablRuntime();
		const cliVersion = scannerCliVersionLabel(runtime);
		const base: ScannerForgeRun = {
			id: newScannerForgeRunId(),
			status: "running",
			target: input.target,
			policies: input.policies,
			policySource: input.policySource,
			rulesRef: input.rulesRef,
			fileName: input.fileName,
			extras: input.extras,
			cliVersion,
			startedAt: startedAt.toISOString(),
		};
		const finish = (patch: Partial<ScannerForgeRun>): ScannerForgeRun => {
			const finishedAt = new Date();
			return {
				...base,
				finishedAt: finishedAt.toISOString(),
				durationMs: finishedAt.getTime() - startedAt.getTime(),
				...patch,
			};
		};

		const resolved = runtime.installed ? await resolveTrustablBinary() : null;
		if (!runtime.installed || !resolved) {
			return finish({ status: "runtime-missing", error: SCANNER_RUNTIME_NOT_INSTALLED });
		}
		if (!runtime.forge) {
			return finish({ status: "failed", error: SCANNER_FORGE_UNSUPPORTED });
		}
		const unknown = input.policies.find((policy) => !runtime.forge?.policies.includes(policy));
		if (unknown) throw new Error(SCANNER_FORGE_POLICY_UNKNOWN(unknown));

		const argv = buildScannerForgeArgv(input, runtime.forge);
		const command = forgeCommandPreview(argv);
		let result;
		try {
			result = await withEmptyForgeDir((cwd) =>
				getScannerProcessRunner().run({
					bin: resolved.bin,
					argv,
					env: forgeEnv(),
					timeoutMs: FORGE_TIMEOUT_MS,
					cwd,
				})
			);
		} catch (error) {
			return finish({
				status: "failed",
				command,
				error: formatScannerError(
					error instanceof Error ? error.message : SCANNER_FORGE_FAILED
				),
			});
		}
		if (result.exitCode !== 0) {
			return finish({
				status: "failed",
				command,
				exitCode: result.exitCode,
				error: formatScannerError(result.stderr || result.stdout || SCANNER_FORGE_FAILED),
			});
		}
		const content = result.stdout;
		if (!content.trim()) {
			return finish({ status: "failed", command, exitCode: 0, error: SCANNER_FORGE_EMPTY_OUTPUT });
		}
		if (Buffer.byteLength(content) > FORGE_MAX_BYTES) {
			return finish({ status: "failed", command, exitCode: 0, error: SCANNER_FORGE_OUTPUT_TOO_LARGE });
		}
		return finish({
			status: "succeeded",
			command,
			exitCode: 0,
			content,
			summary: parseForgeSkill(content),
		});
	}

	async checkForge(content: string, rulesRef?: string): Promise<ScannerForgeCheck> {
		const runtime = await probeTrustablRuntime();
		const resolved = runtime.installed ? await resolveTrustablBinary() : null;
		if (!runtime.installed || !resolved) {
			return parseForgeCheckOutput(2, SCANNER_RUNTIME_NOT_INSTALLED, "");
		}
		const argv = ["forge", "check", FORGE_CHECK_FILE];
		if (rulesRef) argv.push("--rules-ref", rulesRef);
		try {
			const result = await withEmptyForgeDir(async (cwd) => {
				await writeFile(join(cwd, FORGE_CHECK_FILE), content, "utf8");
				return getScannerProcessRunner().run({
					bin: resolved.bin,
					argv,
					env: forgeEnv(),
					timeoutMs: FORGE_CHECK_TIMEOUT_MS,
					cwd,
				});
			});
			return parseForgeCheckOutput(result.exitCode, result.stdout, result.stderr);
		} catch (error) {
			return parseForgeCheckOutput(
				2,
				"",
				error instanceof Error ? error.message : SCANNER_FORGE_FAILED
			);
		}
	}
}

export const trustablAdapterFactory: ScannerAdapterFactory = {
	type: "trustabl",
	create(descriptor: ScannerSourceDescriptor) {
		return new TrustablAdapter(descriptor);
	},
	describe(): ScannerTypeDescriptor {
		const messages = getMessage();
		return {
			type: "trustabl",
			displayName: "Trustabl",
			description: messages.SCANNER_TRUSTABL_DESCRIPTION,
			capabilities: TRUSTABL_CAPABILITIES,
			configFields: trustablConfigFields(),
			authStyle: "api-key",
			authHelp: messages.SCANNER_AUTH_HELP_TRUSTABL,
			docsUrl: "https://github.com/trustabl/trustabl",
			pinnedVersion: TRUSTABL_PINNED_VERSION,
		};
	},
};
