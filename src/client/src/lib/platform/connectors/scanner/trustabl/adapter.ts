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
	ScannerJob,
	ScannerRuntimeInfo,
	ScannerScanInput,
	ScannerScanParams,
	ScannerSourceDescriptor,
	ScannerTypeDescriptor,
} from "../types";
import {
	SCANNER_RUNTIME_NOT_INSTALLED,
	SCANNER_SCAN_FAILED,
} from "@/constants/messages/en";

const TRUSTABL_CAPABILITIES: ScannerCapabilities = {
	install: true,
	scan: true,
	listFindings: true,
};

const SCAN_TIMEOUT_MS = 8 * 60 * 1000;

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
