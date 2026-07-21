import {
	TRACE_ANALYSIS_DIMENSION_DEFINITIONS,
	TraceAnalysisDimensionKey,
} from "@/lib/platform/chat/trace-analysis-registry";

export const TRACE_ANALYSIS_DIMENSIONS = Object.freeze(
	TRACE_ANALYSIS_DIMENSION_DEFINITIONS.map(({ key }) => key)
) as readonly TraceAnalysisDimensionKey[];

export type TraceAnalysisDimension = TraceAnalysisDimensionKey;

export const TRACE_ANALYSIS_DIMENSION_LABELS = Object.freeze(
	Object.fromEntries(
		TRACE_ANALYSIS_DIMENSION_DEFINITIONS.map(({ key, uiLabel }) => [
			key,
			uiLabel,
		])
	)
) as Record<TraceAnalysisDimension, string>;

export type TraceAnalysisSeverity = "info" | "minor" | "major" | "critical";

/**
 * A concrete text substitution patch for a specific span field.
 * `original` is an exact verbatim substring from the span's prompt/response/system field.
 * `replacement` is the corrected text to put in its place.
 */
export type FixPatch = {
	field: "prompt" | "response" | "system";
	span_ref: string;
	original: string;
	replacement: string;
};

export type TraceAnalysisFinding = {
	id: string;
	severity: TraceAnalysisSeverity;
	summary: string;
	detail: string;
	span_refs: string[];
	suggested_fix?: string;
	/** Structured text-edit patches for inline diff preview. Only present when the fix is a concrete text substitution. */
	suggested_fix_patches?: FixPatch[];
	/** tokens: number of tokens that could be saved; usd: estimated USD cost reduction */
	estimated_savings?: {
		tokens?: number;
		usd?: number;
	};
};

export type TraceAnalysisTotals = {
	span_count: number;
	total_tokens: number;
	total_cost_usd: number;
	duration_ms: number;
};

export type TraceAnalysis = {
	trace_id: string;
	summary: string;
	totals: TraceAnalysisTotals;
} & Record<TraceAnalysisDimension, TraceAnalysisFinding[]>;

export function emptyTraceAnalysis(traceId: string): TraceAnalysis {
	const emptyDimensions = Object.fromEntries(
		TRACE_ANALYSIS_DIMENSIONS.map((dimension) => [dimension, []])
	) as unknown as Record<TraceAnalysisDimension, TraceAnalysisFinding[]>;

	return {
		trace_id: traceId,
		summary: "",
		...emptyDimensions,
		totals: {
			span_count: 0,
			total_tokens: 0,
			total_cost_usd: 0,
			duration_ms: 0,
		},
	};
}

/**
 * Ensures every registered dimension key exists when reading stored analysis JSON.
 * Older runs remain readable when new dimensions are appended to the registry.
 */
export function ensureTraceAnalysisDimensions(
	value: Partial<Record<TraceAnalysisDimension, unknown>> | null | undefined
): Record<TraceAnalysisDimension, TraceAnalysisFinding[]> {
	return Object.fromEntries(
		TRACE_ANALYSIS_DIMENSIONS.map((dimension) => [
			dimension,
			Array.isArray(value?.[dimension])
				? (value[dimension] as TraceAnalysisFinding[])
				: [],
		])
	) as Record<TraceAnalysisDimension, TraceAnalysisFinding[]>;
}
