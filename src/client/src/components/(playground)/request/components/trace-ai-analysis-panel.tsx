"use client";

import getMessage from "@/constants/messages";
import TraceImprovementView from "./trace-improvement-view";

export type TraceAiAnalysisScope = "trace" | "span";

interface TraceAiAnalysisPanelProps {
	spanId: string;
	scope?: TraceAiAnalysisScope;
	title?: string;
	description?: string;
}

export default function TraceAiAnalysisPanel({
	spanId,
	scope = "trace",
	title,
	description,
}: TraceAiAnalysisPanelProps) {
	const m = getMessage();

	return (
		<TraceImprovementView
			spanId={spanId}
			scope={scope}
			title={title || m.TRACE_AI_IMPROVEMENT_TITLE}
			description={
				description ||
				(scope === "span"
					? m.TRACE_AI_IMPROVEMENT_SPAN_DESCRIPTION
					: m.TRACE_AI_IMPROVEMENT_DESCRIPTION)
			}
		/>
	);
}
