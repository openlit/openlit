"use client";

import { useEffect, useState } from "react";
import { X, Loader2, Sparkles } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
	TRACE_ANALYSIS_DIMENSIONS,
	TRACE_ANALYSIS_DIMENSION_LABELS,
	TraceAnalysis,
	TraceAnalysisDimension,
	emptyTraceAnalysis,
} from "@/types/trace-analysis";

type CompareTrace = {
	rootSpanId: string;
	runs: {
		runNumber: number;
		analysisJson: string;
		worstSeverity: string;
	}[];
};

function parseLatestAnalysis(runs: CompareTrace["runs"]): TraceAnalysis {
	const latest = runs[runs.length - 1];
	if (!latest) return emptyTraceAnalysis("");
	try {
		const parsed = JSON.parse(latest.analysisJson);
		return { ...emptyTraceAnalysis(parsed.trace_id || ""), ...parsed };
	} catch {
		return emptyTraceAnalysis("");
	}
}

function severityClass(severity: string) {
	if (severity === "critical") return "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300";
	if (severity === "major") return "bg-orange-100 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300";
	if (severity === "minor") return "bg-yellow-100 text-yellow-700 dark:bg-yellow-950/50 dark:text-yellow-300";
	return "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300";
}

function badgeDotClass(severity: string) {
	if (severity === "critical") return "bg-red-500";
	if (severity === "major") return "bg-orange-400";
	if (severity === "minor") return "bg-yellow-400";
	if (severity === "info") return "bg-blue-400";
	return "bg-green-400";
}

function TraceColumn({
	trace,
	activeDimension,
}: {
	trace: CompareTrace;
	activeDimension: TraceAnalysisDimension;
}) {
	const analysis = parseLatestAnalysis(trace.runs);
	const findings = analysis[activeDimension];
	const short = trace.rootSpanId.slice(0, 12);

	return (
		<div className="min-w-0 flex-1">
			<div className="mb-2 flex items-center gap-2">
				<span
					className={`h-2 w-2 shrink-0 rounded-full ${badgeDotClass(trace.runs[trace.runs.length - 1]?.worstSeverity || "")}`}
				/>
				<span className="font-mono text-xs text-stone-700 dark:text-stone-200 truncate" title={trace.rootSpanId}>
					{short}…
				</span>
				<span className="text-xs text-stone-400 dark:text-stone-500">{trace.runs.length} run{trace.runs.length !== 1 ? "s" : ""}</span>
			</div>
			{findings.length === 0 ? (
				<div className="rounded-md border border-stone-200 bg-stone-50 p-3 text-xs text-stone-500 dark:border-stone-800 dark:bg-stone-900/60 dark:text-stone-400">
					No findings in this dimension.
				</div>
			) : (
				<div className="space-y-2">
					{findings.map((finding) => (
						<div
							key={finding.id}
							className="rounded-md border border-stone-200 bg-stone-50 p-2.5 dark:border-stone-800 dark:bg-stone-900/60"
						>
							<div className="flex items-start gap-2">
								<span
									className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold ${severityClass(finding.severity)}`}
								>
									{finding.severity}
								</span>
								<div className="min-w-0 text-xs font-semibold text-stone-900 dark:text-stone-50">
									{finding.summary}
								</div>
							</div>
							<div className="mt-1.5 text-xs leading-relaxed text-stone-600 dark:text-stone-300 line-clamp-2">
								{finding.detail}
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

export default function TraceCompareView({
	spanIds,
	onClose,
}: {
	spanIds: string[];
	onClose: () => void;
}) {
	const [traces, setTraces] = useState<CompareTrace[] | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [activeDimension, setActiveDimension] = useState<TraceAnalysisDimension>("improvements");

	useEffect(() => {
		if (!spanIds.length) return;
		setIsLoading(true);
		setError(null);
		fetch("/api/chat/improvement/compare", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ spanIds }),
		})
			.then((r) => r.json())
			.then((res) => {
				if (res.err || !Array.isArray(res.data)) {
					setError(typeof res.err === "string" ? res.err : "Failed to load comparison");
				} else {
					setTraces(res.data);
				}
			})
			.catch(() => setError("Failed to load comparison"))
			.finally(() => setIsLoading(false));
	}, [spanIds]);

	const tracesWithAnalysis = (traces || []).filter((t) => t.runs.length > 0);
	const tracesWithoutAnalysis = (traces || []).filter((t) => t.runs.length === 0);

	return (
		<div className="flex h-full flex-col bg-white dark:bg-stone-950">
			<div className="flex shrink-0 items-center justify-between gap-3 border-b border-stone-200 bg-stone-50 px-3 py-2 dark:border-stone-800 dark:bg-stone-900">
				<div className="flex items-center gap-2">
					<Sparkles className="h-4 w-4 shrink-0 text-primary" />
					<span className="text-sm font-semibold text-stone-900 dark:text-stone-100">
						Compare {spanIds.length} traces
					</span>
				</div>
				<button
					onClick={onClose}
					className="p-1 rounded text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-200 transition-colors"
				>
					<X className="h-3.5 w-3.5" />
				</button>
			</div>

			<div className="min-h-0 flex-1 overflow-auto px-4 py-3">
				{isLoading && (
					<div className="flex h-32 items-center justify-center gap-2 text-sm text-stone-500">
						<Loader2 className="h-4 w-4 animate-spin" />
						Loading analyses…
					</div>
				)}

				{error && (
					<div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
						{error}
					</div>
				)}

				{!isLoading && !error && traces && (
					<>
						{tracesWithoutAnalysis.length > 0 && (
							<div className="mb-3 rounded-md border border-yellow-200 bg-yellow-50 p-2.5 text-xs text-yellow-800 dark:border-yellow-900 dark:bg-yellow-950/40 dark:text-yellow-300">
								{tracesWithoutAnalysis.length} trace{tracesWithoutAnalysis.length > 1 ? "s have" : " has"} no analysis yet.
								Run <strong>Analyze</strong> on each to include them.
							</div>
						)}

						{tracesWithAnalysis.length < 2 ? (
							<div className="flex h-32 items-center justify-center text-sm text-stone-500">
								At least 2 analyzed traces are needed to compare. Run analysis on more traces first.
							</div>
						) : (
							<Tabs
								value={activeDimension}
								onValueChange={(v) => setActiveDimension(v as TraceAnalysisDimension)}
							>
								<TabsList className="h-auto flex w-full justify-start overflow-auto rounded-none border-b border-stone-200 bg-transparent p-0 dark:border-stone-800 dark:bg-transparent mb-3">
									{TRACE_ANALYSIS_DIMENSIONS.map((dim) => (
										<TabsTrigger
											key={dim}
											value={dim}
											className="rounded-none border-b-2 border-transparent px-3 py-2 text-xs text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none dark:data-[state=active]:bg-transparent dark:data-[state=active]:text-primary"
										>
											{TRACE_ANALYSIS_DIMENSION_LABELS[dim]}
											<Badge variant="outline" className="ml-1 px-1 py-0 text-[10px] border-stone-300 dark:border-stone-600">
												{tracesWithAnalysis.reduce(
													(sum, t) => sum + parseLatestAnalysis(t.runs)[dim].length,
													0
												)}
											</Badge>
										</TabsTrigger>
									))}
								</TabsList>

								{TRACE_ANALYSIS_DIMENSIONS.map((dim) => (
									<TabsContent key={dim} value={dim}>
										<div className="flex gap-3">
											{tracesWithAnalysis.map((trace) => (
												<TraceColumn
													key={trace.rootSpanId}
													trace={trace}
													activeDimension={dim}
												/>
											))}
										</div>
									</TabsContent>
								))}
							</Tabs>
						)}
					</>
				)}
			</div>
		</div>
	);
}
