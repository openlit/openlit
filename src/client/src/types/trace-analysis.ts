export const TRACE_ANALYSIS_DIMENSIONS = [
	"strengths",
	"improvements",
	"wrong_turns",
	"cost",
	"token_efficiency",
	"path_analysis",
] as const;

export type TraceAnalysisDimension = (typeof TRACE_ANALYSIS_DIMENSIONS)[number];

export const TRACE_ANALYSIS_DIMENSION_LABELS: Record<TraceAnalysisDimension, string> = {
	strengths: "Strengths",
	improvements: "Improvements",
	wrong_turns: "Wrong turns",
	cost: "Cost",
	token_efficiency: "Token efficiency",
	path_analysis: "Path",
};

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
	strengths: TraceAnalysisFinding[];
	improvements: TraceAnalysisFinding[];
	wrong_turns: TraceAnalysisFinding[];
	cost: TraceAnalysisFinding[];
	token_efficiency: TraceAnalysisFinding[];
	path_analysis: TraceAnalysisFinding[];
	totals: TraceAnalysisTotals;
};

export function emptyTraceAnalysis(traceId: string): TraceAnalysis {
	return {
		trace_id: traceId,
		summary: "",
		strengths: [],
		improvements: [],
		wrong_turns: [],
		cost: [],
		token_efficiency: [],
		path_analysis: [],
		totals: {
			span_count: 0,
			total_tokens: 0,
			total_cost_usd: 0,
			duration_ms: 0,
		},
	};
}
