import {
	SCANNER_ENRICH_ATTEMPTS_INVALID,
	SCANNER_ENRICH_FINDING_INVALID,
	SCANNER_ENRICH_MODEL_INVALID,
	SCANNER_ENRICH_PROVIDER_INVALID,
	SCANNER_JOB_ID_INVALID,
} from "@/constants/messages/en";
import { isScannerJobId } from "./job-findings";
import { normalizeScannerRef } from "./target";
import type { ScannerEnrichInput, ScannerEnrichProvider } from "./types";

export const SCANNER_ENRICH_RUN_ID_PATTERN = /^enrich:[A-Za-z0-9_-]+$/;
export const SCANNER_ENRICH_MAX_ATTEMPTS = 2;
export const ENRICH_RUN_TIMEOUT_MS = 10 * 60 * 1000;

/** LLM providers Trustabl `enrich` supports, with the env var it reads for each. */
export const SCANNER_ENRICH_PROVIDERS: {
	id: ScannerEnrichProvider;
	label: string;
	envKey: string;
}[] = [
	{ id: "anthropic", label: "Anthropic", envKey: "ANTHROPIC_API_KEY" },
	{ id: "openai", label: "OpenAI", envKey: "OPENAI_API_KEY" },
	{ id: "google", label: "Google", envKey: "GOOGLE_API_KEY" },
];

export function scannerEnrichProviderEnvKey(provider: ScannerEnrichProvider): string {
	return SCANNER_ENRICH_PROVIDERS.find((item) => item.id === provider)?.envKey || "";
}

const PROVIDERS = new Set<ScannerEnrichProvider>(SCANNER_ENRICH_PROVIDERS.map((item) => item.id));
const MODEL = /^[A-Za-z0-9._:/-]{1,100}$/;
const MAX_ALERT_NUMBER = 10_000;

export function isScannerEnrichRunId(value: string): boolean {
	return SCANNER_ENRICH_RUN_ID_PATTERN.test(value);
}

export function isScannerEnrichAlertNumber(value: unknown): value is number {
	return (
		typeof value === "number" &&
		Number.isInteger(value) &&
		value >= 1 &&
		value <= MAX_ALERT_NUMBER
	);
}

export function parseScannerEnrichInput(body: Record<string, unknown>): ScannerEnrichInput {
	const jobId = String(body.jobId || "");
	if (!isScannerJobId(jobId)) throw new Error(SCANNER_JOB_ID_INVALID);
	if (!isScannerEnrichAlertNumber(body.alertNumber)) {
		throw new Error(SCANNER_ENRICH_FINDING_INVALID);
	}
	const provider = String(body.provider || "") as ScannerEnrichProvider;
	if (!PROVIDERS.has(provider)) throw new Error(SCANNER_ENRICH_PROVIDER_INVALID);
	const model = body.model == null ? "" : String(body.model).trim();
	if (model && !MODEL.test(model)) throw new Error(SCANNER_ENRICH_MODEL_INVALID);
	const attempts = body.attempts == null ? 1 : body.attempts;
	if (
		typeof attempts !== "number" ||
		!Number.isInteger(attempts) ||
		attempts < 1 ||
		attempts > SCANNER_ENRICH_MAX_ATTEMPTS
	) {
		throw new Error(SCANNER_ENRICH_ATTEMPTS_INVALID);
	}
	return {
		jobId,
		alertNumber: body.alertNumber,
		provider,
		model: model || undefined,
		attempts,
		recheck: body.recheck !== false,
		baseRef: normalizeScannerRef(body.baseRef),
	};
}
