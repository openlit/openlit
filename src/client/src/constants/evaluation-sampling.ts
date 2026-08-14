export const DEFAULT_EVAL_SAMPLE_RATE = 1;

export function evalSampleRateToPercent(rate: number | undefined): string {
	if (typeof rate !== "number" || !Number.isFinite(rate)) {
		return String(DEFAULT_EVAL_SAMPLE_RATE * 100);
	}
	return String(Number((rate * 100).toFixed(4)));
}
