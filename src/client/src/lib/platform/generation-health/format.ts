import getMessage from "@/constants/messages";
import type { GenerationHealthChip } from "./classify";

export function fillTemplate(
	template: string,
	values: Record<string, string | number>
): string {
	return Object.entries(values).reduce(
		(text, [key, value]) => text.split(`{${key}}`).join(String(value)),
		template
	);
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
	if (eligible <= 0) return m.GENERATION_HEALTH_TIP_NO_ELIGIBLE;
	if (count <= 0) {
		return fillTemplate(m.GENERATION_HEALTH_TIP_NONE, { eligible });
	}
	return fillTemplate(m.GENERATION_HEALTH_TIP_COUNT, { count, eligible });
}

export function generationHealthSkippedLine(
	skipped: number,
	total: number
): string | null {
	if (skipped <= 0 || total <= 0) return null;
	return fillTemplate(getMessage().GENERATION_HEALTH_STAT_SKIPPED, {
		skipped,
		total,
	});
}
