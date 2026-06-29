import { createHash } from "crypto";

import { DEFAULT_EVAL_SAMPLE_RATE } from "@/constants/evaluation-sampling";

export { DEFAULT_EVAL_SAMPLE_RATE };

export function normalizeEvalSampleRate(value: unknown): number {
	if (value === undefined || value === null || value === "") {
		return DEFAULT_EVAL_SAMPLE_RATE;
	}

	const numeric =
		typeof value === "number" ? value : Number.parseFloat(String(value));

	if (!Number.isFinite(numeric)) {
		return Number.NaN;
	}

	if (numeric <= 0) {
		return 0;
	}
	if (numeric >= 1) {
		return 1;
	}

	return numeric;
}

export function resolveEvalSampleRate(value: unknown): number {
	const normalized = normalizeEvalSampleRate(value);
	if (Number.isNaN(normalized)) {
		return DEFAULT_EVAL_SAMPLE_RATE;
	}
	return normalized;
}

export function shouldAutoEvaluateSpan(
	spanId: string,
	sampleRate: number
): boolean {
	if (sampleRate >= 1) {
		return true;
	}
	if (sampleRate <= 0) {
		return false;
	}

	const hash = createHash("sha256").update(spanId).digest();
	const normalized = hash.readUInt32BE(0) / 0xffffffff;
	return normalized < sampleRate;
}
