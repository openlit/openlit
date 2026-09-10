import getMessage from "@/constants/messages";
import type { GenerationHealthChip } from "./classify";

/** Coerce ClickHouse `nan` / missing metrics to 0 so chips never render "NaN". */
export function asFiniteNumber(value: unknown, fallback = 0): number {
	const numeric = typeof value === "number" ? value : Number(value);
	return Number.isFinite(numeric) ? numeric : fallback;
}

export function fillTemplate(
	template: string,
	values: Record<string, string | number>
): string {
	return Object.entries(values).reduce((text, [key, value]) => {
		const rendered =
			typeof value === "number" && !Number.isFinite(value)
				? String(0)
				: String(value);
		return text.split(`{${key}}`).join(rendered);
	}, template);
}

export function generationHealthChipLabel(chip: GenerationHealthChip): string {
	const m = getMessage();
	if (chip === "truncated") return m.GENERATION_HEALTH_TRUNCATED;
	if (chip === "filtered") return m.GENERATION_HEALTH_FILTERED;
	if (chip === "empty") return m.GENERATION_HEALTH_EMPTY;
	return m.GENERATION_HEALTH_SWAPPED;
}

export function generationHealthTipMeaning(chip: GenerationHealthChip): string {
	const m = getMessage();
	if (chip === "truncated") return m.GENERATION_HEALTH_TIP_TRUNCATED;
	if (chip === "filtered") return m.GENERATION_HEALTH_TIP_FILTERED;
	if (chip === "empty") return m.GENERATION_HEALTH_TIP_EMPTY;
	return m.GENERATION_HEALTH_TIP_SWAPPED;
}

export function generationHealthCountLine(
	count: number,
	eligible: number
): string {
	const m = getMessage();
	const safeCount = asFiniteNumber(count);
	const safeEligible = asFiniteNumber(eligible);
	if (safeEligible <= 0) return m.GENERATION_HEALTH_TIP_NO_ELIGIBLE;
	if (safeCount <= 0) {
		return fillTemplate(m.GENERATION_HEALTH_TIP_NONE, { eligible: safeEligible });
	}
	return fillTemplate(m.GENERATION_HEALTH_TIP_COUNT, {
		count: safeCount,
		eligible: safeEligible,
	});
}

export function generationHealthSkippedLine(
	skipped: number,
	total: number
): string | null {
	const safeSkipped = asFiniteNumber(skipped);
	const safeTotal = asFiniteNumber(total);
	if (safeSkipped <= 0 || safeTotal <= 0) return null;
	return fillTemplate(getMessage().GENERATION_HEALTH_STAT_SKIPPED, {
		skipped: safeSkipped,
		total: safeTotal,
	});
}
