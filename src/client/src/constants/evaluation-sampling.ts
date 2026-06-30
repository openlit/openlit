export const DEFAULT_EVAL_SAMPLE_RATE = 1;

export function evalSampleRateToPercent(
	rate: number | undefined
): number {
	if (typeof rate !== "number" || !Number.isFinite(rate)) {
		return DEFAULT_EVAL_SAMPLE_RATE * 100;
	}
	return Math.round(rate * 100);
}
