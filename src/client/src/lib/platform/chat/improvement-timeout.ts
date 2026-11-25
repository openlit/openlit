/**
 * How long the trace improvement view waits for an analysis run before it
 * gives up. Local models can take far longer than the default on large traces,
 * so OPENLIT_TRACE_IMPROVEMENT_TIMEOUT_MS raises it. This is separate from
 * OPENLIT_MODEL_ENDPOINT_TIMEOUT_MS, which bounds idle time on a single model
 * call rather than the whole run.
 */
export const DEFAULT_TRACE_IMPROVEMENT_TIMEOUT_MS = 120_000;

/** setTimeout's largest delay. A larger one overflows and fires at once. */
export const MAX_TRACE_IMPROVEMENT_TIMEOUT_MS = 2_147_483_647;

export function traceImprovementTimeoutMs() {
	const configured = Number(process.env.OPENLIT_TRACE_IMPROVEMENT_TIMEOUT_MS);
	if (!Number.isFinite(configured) || configured <= 0) {
		return DEFAULT_TRACE_IMPROVEMENT_TIMEOUT_MS;
	}
	return Math.min(configured, MAX_TRACE_IMPROVEMENT_TIMEOUT_MS);
}
