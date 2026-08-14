export const EVALUATION_SOURCE = {
	AUTO: "auto",
	AUTO_SKIPPED: "auto_skipped",
	MANUAL: "manual",
	MANUAL_FEEDBACK: "manual_feedback",
} as const;

/** Sources that mark a span as handled by the auto-evaluation cron (evaluated or skipped). */
export const AUTO_EVALUATION_HANDLED_SOURCES = [
	EVALUATION_SOURCE.AUTO,
	EVALUATION_SOURCE.AUTO_SKIPPED,
] as const;

export function isAutoEvaluationHandledSource(source: unknown): boolean {
	return (
		source === EVALUATION_SOURCE.AUTO ||
		source === EVALUATION_SOURCE.AUTO_SKIPPED
	);
}
