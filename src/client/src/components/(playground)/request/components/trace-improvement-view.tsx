"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import {
	CheckCircle2,
	Circle,
	Coins,
	Database,
	Eye,
	EyeOff,
	Loader2,
	MessageSquarePlus,
	RefreshCw,
	Sparkles,
	TrendingDown,
	TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import {
	FixPatch,
	TRACE_ANALYSIS_DIMENSION_LABELS,
	TRACE_ANALYSIS_DIMENSIONS,
	TraceAnalysis,
	TraceAnalysisDimension,
	TraceAnalysisFinding,
	emptyTraceAnalysis,
} from "@/types/trace-analysis";
import { useRequest } from "../request-context";
import getMessage from "@/constants/messages";
import { CLIENT_EVENTS } from "@/constants/events";

type TraceAnalysisRunResponse = {
	id: string;
	runNumber: number;
	analysisJson: string;
	summary?: string;
	modelProvider?: string;
	modelName?: string;
	promptTokens?: number;
	completionTokens?: number;
	cost?: number;
	createdAt?: string;
};

type ImprovementResponse = {
	data?: {
		rootSpanId?: string;
		runs?: TraceAnalysisRunResponse[];
	};
	err?: string;
};

type ImprovementStep = {
	label: string;
	status: "active" | "complete";
	detail?: string;
};

type AnalysisRun = {
	id: string;
	label: string;
	createdAt?: string;
	promptTokens?: number;
	completionTokens?: number;
	cost?: number;
	analysis: TraceAnalysis;
};

function AnalysisStepTimeline({ steps }: { steps: ImprovementStep[] }) {
	return (
		<div className="relative space-y-1.5 pl-7">
			<div className="absolute bottom-2 left-[9px] top-2 w-px bg-gradient-to-b from-primary/50 via-stone-300 to-transparent dark:via-stone-700" />
			{steps.map((step, index) => {
				const isActive = step.status === "active";
				const Icon = isActive ? Loader2 : CheckCircle2;
				return (
					<div
						key={`${step.label}-${index}`}
						className={`relative flex gap-2 rounded-md py-1.5 pr-2 text-xs transition-colors ${
							isActive ? "bg-primary/[0.04] dark:bg-primary/[0.08]" : ""
						}`}
					>
						<span
							className={`absolute -left-7 top-1.5 flex h-5 w-5 items-center justify-center rounded-full border ${
								isActive
									? "border-primary/30 bg-primary/10 text-primary shadow-[0_0_0_4px_rgba(243,108,6,0.08)]"
									: "border-stone-200 bg-white text-green-600 dark:border-stone-800 dark:bg-stone-950 dark:text-green-400"
							}`}
						>
							<Icon className={`h-3 w-3 ${isActive ? "animate-spin" : ""}`} />
						</span>
						<div className="min-w-0">
							<div
								className={`font-medium ${
									isActive
										? "text-stone-900 dark:text-stone-100"
										: "text-stone-600 dark:text-stone-300"
								}`}
							>
								{step.label}
							</div>
							{step.detail ? (
								<div className="truncate text-[11px] text-stone-500 dark:text-stone-500">
									{step.detail}
								</div>
							) : null}
						</div>
					</div>
				);
			})}
		</div>
	);
}

function AnalysisProgress({
	steps,
	isLoading,
	title,
}: {
	steps: ImprovementStep[];
	isLoading: boolean;
	title: string;
}) {
	if (!steps.length) return null;
	const completedCount = steps.filter((step) => step.status === "complete").length;
	const content = <AnalysisStepTimeline steps={steps} />;

	if (isLoading) {
		return (
			<div className="mt-2 rounded-md border border-stone-200 bg-stone-50 p-3 dark:border-stone-800 dark:bg-stone-900/60">
				<div className="mb-2 flex items-center justify-between gap-2">
					<div className="text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
						{title}
					</div>
					<div className="text-[11px] text-stone-400 dark:text-stone-500">
						{completedCount}/{steps.length}
					</div>
				</div>
				{content}
			</div>
		);
	}

	return (
		<Accordion type="single" collapsible className="mt-2">
			<AccordionItem
				value="progress"
				className="rounded-md border border-stone-200 bg-stone-50 px-3 dark:border-stone-800 dark:bg-stone-900/60"
			>
				<AccordionTrigger className="py-2 text-xs font-semibold uppercase tracking-wide text-stone-500 hover:no-underline dark:text-stone-400">
					<span>{title}</span>
					<span className="ml-auto mr-2 text-[11px] font-normal normal-case tracking-normal text-stone-400 dark:text-stone-500">
						{completedCount}/{steps.length}
					</span>
				</AccordionTrigger>
				<AccordionContent className="pb-3">
					{content}
				</AccordionContent>
			</AccordionItem>
		</Accordion>
	);
}

const EMPTY_DIMENSION_COPY: Record<TraceAnalysisDimension, { summary: string; detail: string }> = {
	strengths: {
		summary: "No explicit strengths were identified in this run.",
		detail: "The analysis did not find a concrete positive pattern worth calling out. This does not mean the trace failed; it means the model did not see a specific strength with enough evidence.",
	},
	improvements: {
		summary: "No general improvements are required right now.",
		detail: "The trace did not show a broad improvement opportunity outside the more specific cost, token, path, or wrong-turn categories.",
	},
	wrong_turns: {
		summary: "No wrong turns were detected.",
		detail: "The trace did not show clear retries, off-task branches, unnecessary rework, or agent decisions that caused a detour.",
	},
	cost: {
		summary: "Cost looks acceptable for this trace.",
		detail: "No span stood out as clearly over budget or using a model that was obviously too expensive for the observed subtask.",
	},
	token_efficiency: {
		summary: "Token usage looks acceptable for this trace.",
		detail: "The analysis did not find obvious prompt bloat, repeated context, oversized tool outputs, or duplicate retrieval payloads.",
	},
	path_analysis: {
		summary: "The execution path looks reasonable.",
		detail: "The trace did not show clear routing loops, missed branches, unnecessary tool hops, or inappropriate tool choices.",
	},
};

function MarkdownText({ content }: { content: string }) {
	return (
		<div className="chat-markdown">
			<ReactMarkdown
				components={{
					p({ children }) {
						return <p className="my-1.5 text-sm leading-relaxed text-stone-800 dark:text-stone-100">{children}</p>;
					},
					ul({ children }) {
						return <ul className="my-1.5 list-disc space-y-1 pl-5 text-sm text-stone-800 dark:text-stone-100">{children}</ul>;
					},
					ol({ children }) {
						return <ol className="my-1.5 list-decimal space-y-1 pl-5 text-sm text-stone-800 dark:text-stone-100">{children}</ol>;
					},
					li({ children }) {
						return <li className="text-sm leading-relaxed text-stone-800 dark:text-stone-100">{children}</li>;
					},
					strong({ children }) {
						return <strong className="font-semibold text-stone-900 dark:text-stone-300">{children}</strong>;
					},
					code({ children }) {
						return <code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[14px] text-stone-900 dark:bg-stone-700 dark:text-stone-300">{children}</code>;
					},
				}}
			>
				{content}
			</ReactMarkdown>
		</div>
	);
}

function parseAnalysisMessage(content?: string): TraceAnalysis | null {
	if (!content) return null;
	try {
		const parsed = JSON.parse(content);
		if (!parsed || typeof parsed !== "object") return null;
		return normalizeTraceAnalysis(parsed);
	} catch {
		return null;
	}
}

function normalizeFinding(finding: any, index: number): TraceAnalysisFinding {
	const severity = ["info", "minor", "major", "critical"].includes(finding?.severity)
		? finding.severity
		: "info";
	return {
		id: String(finding?.id || `finding-${index}`),
		severity,
		summary: String(finding?.summary || "Untitled finding").slice(0, 140),
		detail: String(finding?.detail || finding?.description || ""),
		span_refs: Array.isArray(finding?.span_refs)
			? finding.span_refs.map(String)
			: Array.isArray(finding?.spanRefs)
				? finding.spanRefs.map(String)
				: [],
		...(finding?.suggested_fix ? { suggested_fix: String(finding.suggested_fix) } : {}),
		...(Array.isArray(finding?.suggested_fix_patches)
			? { suggested_fix_patches: finding.suggested_fix_patches }
			: {}),
		...(finding?.estimated_savings && typeof finding.estimated_savings === "object"
			? { estimated_savings: finding.estimated_savings }
			: {}),
	};
}

function normalizeFindings(value: unknown): TraceAnalysisFinding[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter((finding) => finding && typeof finding === "object")
		.map(normalizeFinding);
}

function normalizeTraceAnalysis(value: any): TraceAnalysis {
	const base = emptyTraceAnalysis(String(value?.trace_id || value?.traceId || ""));
	const totals = value?.totals && typeof value.totals === "object" ? value.totals : {};
	const normalized: TraceAnalysis = {
		...base,
		...value,
		trace_id: String(value?.trace_id || value?.traceId || base.trace_id),
		summary: String(value?.summary || ""),
		totals: {
			span_count: Number(totals.span_count || totals.spanCount || 0),
			total_tokens: Number(totals.total_tokens || totals.totalTokens || 0),
			total_cost_usd: Number(totals.total_cost_usd || totals.totalCostUsd || 0),
			duration_ms: Number(totals.duration_ms || totals.durationMs || 0),
		},
	};

	for (const dimension of TRACE_ANALYSIS_DIMENSIONS) {
		normalized[dimension] = normalizeFindings(value?.[dimension]);
	}

	return normalized;
}

function getDimensionFindings(analysis: TraceAnalysis | null | undefined, dimension: TraceAnalysisDimension) {
	return Array.isArray(analysis?.[dimension]) ? analysis[dimension] : [];
}

function severityClass(severity: string) {
	if (severity === "critical") return "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300";
	if (severity === "major") return "bg-orange-100 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300";
	if (severity === "minor") return "bg-yellow-100 text-yellow-700 dark:bg-yellow-950/50 dark:text-yellow-300";
	return "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300";
}

function computeTrend(current: TraceAnalysis, previous: TraceAnalysis) {
	const currentIds = new Set(
		TRACE_ANALYSIS_DIMENSIONS.flatMap((d) => getDimensionFindings(current, d).map((f) => f.id))
	);
	const previousIds = new Set(
		TRACE_ANALYSIS_DIMENSIONS.flatMap((d) => getDimensionFindings(previous, d).map((f) => f.id))
	);
	return {
		newFindings: Array.from(currentIds).filter((id) => !previousIds.has(id)).length,
		resolvedFindings: Array.from(previousIds).filter((id) => !currentIds.has(id)).length,
		costDelta:
			(current.totals.total_cost_usd || 0) - (previous.totals.total_cost_usd || 0),
	};
}

// ── Word-level diff engine ────────────────────────────────────────────────────

type DiffSegment = { text: string; type: "common" | "removed" | "added" };

function diffWords(original: string, replacement: string): DiffSegment[] {
	const tokenize = (s: string) => s.match(/\S+|\s+/g) ?? [];
	const a = tokenize(original);
	const b = tokenize(replacement);
	const m = a.length, n = b.length;
	const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
	for (let i = 1; i <= m; i++)
		for (let j = 1; j <= n; j++)
			dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
	const result: DiffSegment[] = [];
	let i = m, j = n;
	while (i > 0 || j > 0) {
		if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
			result.unshift({ text: a[i - 1], type: "common" });
			i--; j--;
		} else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
			result.unshift({ text: b[j - 1], type: "added" });
			j--;
		} else {
			result.unshift({ text: a[i - 1], type: "removed" });
			i--;
		}
	}
	return result;
}

function DiffView({ patches }: { patches: FixPatch[] }) {
	return (
		<div className="mt-2 space-y-2">
			{patches.map((patch, idx) => {
				const segments = diffWords(patch.original, patch.replacement);
				return (
					<div key={idx} className="overflow-hidden rounded border border-stone-200 dark:border-stone-700">
						<div className="flex items-center gap-1.5 bg-stone-100 px-2 py-1 dark:bg-stone-800">
							<span className="text-[10px] font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
								{patch.field}
							</span>
							<span className="font-mono text-[10px] text-stone-400 dark:text-stone-500">
								· {patch.span_ref.slice(0, 8)}…
							</span>
						</div>
						<div className="whitespace-pre-wrap break-words bg-white px-2 py-2 font-mono text-xs leading-relaxed dark:bg-stone-950">
							{segments.map((seg, j) =>
								seg.type === "removed" ? (
									<span
										key={j}
										className="bg-red-50 text-red-600 line-through dark:bg-red-950/50 dark:text-red-400"
									>
										{seg.text}
									</span>
								) : seg.type === "added" ? (
									<span
										key={j}
										className="bg-green-50 text-green-700 underline dark:bg-green-950/50 dark:text-green-300"
									>
										{seg.text}
									</span>
								) : (
									<span key={j} className="text-stone-700 dark:text-stone-300">
										{seg.text}
									</span>
								)
							)}
						</div>
					</div>
				);
			})}
		</div>
	);
}

// ─────────────────────────────────────────────────────────────────────────────

function FindingCard({
	finding,
	onSpanClick,
	onTryInChat,
}: {
	finding: TraceAnalysisFinding;
	onSpanClick: (spanId: string) => void;
	onTryInChat: (finding: TraceAnalysisFinding) => void;
}) {
	const m = getMessage();
	const [showDiff, setShowDiff] = useState(false);
	const hasPatches =
		Array.isArray(finding.suggested_fix_patches) && finding.suggested_fix_patches.length > 0;
	const gist = finding.detail.split(/(?<=[.!?])\s+/)[0] || finding.detail;
	const footerMetrics = [
		finding.estimated_savings?.tokens
			? m.TRACE_AI_TOKENS_SAVED(finding.estimated_savings.tokens.toLocaleString())
			: "",
		finding.estimated_savings?.usd
			? m.TRACE_AI_USD_SAVED(finding.estimated_savings.usd.toFixed(4))
			: "",
	].filter(Boolean);
	return (
		<div className="rounded-md border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-950">
			<div className="min-w-0 space-y-1">
				<div className="text-sm font-semibold leading-snug text-stone-900 dark:text-stone-100">
					{finding.summary}
				</div>
				<div className="text-sm leading-relaxed text-stone-600 dark:text-stone-300">
					{gist}
				</div>
			</div>
			<Accordion type="single" collapsible className="mt-2">
				<AccordionItem value="detail" className="border-0">
					<AccordionTrigger className="py-1 text-xs font-medium text-stone-500 hover:no-underline dark:text-stone-400">
						{m.TRACE_AI_DETAILS}
					</AccordionTrigger>
					<AccordionContent className="pb-0">
						<MarkdownText content={finding.detail} />
						{finding.suggested_fix && (
							<div className="mt-2 rounded bg-white p-2 dark:bg-stone-950">
								<div className="mb-1 flex items-center justify-between gap-2">
									<span className="text-xs font-semibold text-stone-500 dark:text-stone-400">
										{m.TRACE_AI_SUGGESTED_FIX}
									</span>
									<div className="flex items-center gap-1">
										{hasPatches && (
											<button
												onClick={() => setShowDiff(!showDiff)}
												className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors ${
													showDiff
														? "bg-primary/10 text-primary"
														: "text-stone-500 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800"
												}`}
												title={showDiff ? "Hide diff" : "Preview text changes"}
											>
												{showDiff ? (
													<EyeOff className="h-3 w-3" />
												) : (
													<Eye className="h-3 w-3" />
												)}
												{showDiff ? "Hide diff" : "Show diff"}
											</button>
										)}
										<button
											onClick={() => onTryInChat(finding)}
											className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10 transition-colors"
										>
											<MessageSquarePlus className="h-3 w-3" />
											{m.TRACE_AI_TRY_IN_CHAT}
										</button>
									</div>
								</div>
								<MarkdownText content={finding.suggested_fix} />
								{showDiff && hasPatches && (
									<DiffView patches={finding.suggested_fix_patches!} />
								)}
							</div>
						)}
					</AccordionContent>
				</AccordionItem>
			</Accordion>
			<div className="mt-3 flex flex-col justify-between gap-2 border-t border-stone-200 pt-2 dark:border-stone-800">
				<div className="flex flex-wrap items-center gap-1.5">
					<span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${severityClass(finding.severity)}`}>
						{finding.severity}
					</span>
					{footerMetrics.map((metric) => (
						<Badge
							key={metric}
							variant="outline"
							className="border-stone-200 text-[11px] text-stone-600 dark:border-stone-700 dark:text-stone-300"
						>
							{metric}
						</Badge>
					))}
				</div>
				<div className="flex flex-wrap gap-1.5">
					{finding.span_refs.map((spanId) => (
						<button
							key={spanId}
							onClick={() => onSpanClick(spanId)}
							className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[11px] text-stone-700 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
						>
							{spanId}
						</button>
					))}
				</div>
			</div>
		</div>
	);
}

export default function TraceImprovementView({
	spanId,
	scope = "trace",
	title,
	description,
}: {
	spanId: string;
	scope?: "trace" | "span";
	title?: string;
	description?: string;
}) {
	const m = getMessage();
	const router = useRouter();
	const posthog = usePostHog();
	const [, updateRequest] = useRequest();
	const [analysis, setAnalysis] = useState<ImprovementResponse | null>(null);
	const [streamedAnalysis, setStreamedAnalysis] = useState<TraceAnalysis | null>(null);
	const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [isFetched, setIsFetched] = useState(false);
	const [steps, setSteps] = useState<ImprovementStep[]>([]);
	const requestKeyRef = useRef(`${scope}:${spanId}`);

	const getRequestKey = (targetSpanId = spanId, targetScope = scope) =>
		`${targetScope}:${targetSpanId}`;

	const upsertStep = (step: ImprovementStep) => {
		setSteps((prev) => {
			const existingIndex = prev.findIndex((item) => item.label === step.label);
			if (existingIndex === -1) return [...prev, step];
			const next = [...prev];
			next[existingIndex] = { ...next[existingIndex], ...step };
			return next;
		});
	};

	const fetchAnalysis = async (
		targetSpanId = spanId,
		targetScope = scope,
		requestKey = getRequestKey(targetSpanId, targetScope)
	) => {
		try {
			setIsLoading(true);
			const scopeParam = targetScope === "span" ? "?scope=span" : "";
			const res = await fetch(`/api/chat/improvement/${targetSpanId}${scopeParam}`);
			if (!res.ok) {
				const err = await res.json();
				throw new Error(typeof err === "string" ? err : m.TRACE_AI_LOAD_FAILED);
			}
			const result = await res.json();
			if (requestKeyRef.current !== requestKey) return;
			setAnalysis(result);
			posthog?.capture(CLIENT_EVENTS.AI_ANALYSIS_VIEWED, {
				spanId: targetSpanId,
				scope: targetScope,
				runCount: result?.data?.runs?.length || 0,
			});
		} catch (err: any) {
			if (requestKeyRef.current !== requestKey) return;
			toast.error(err?.message || m.TRACE_AI_LOAD_FAILED, {
					id: "trace-improvement",
				});
		} finally {
			if (requestKeyRef.current === requestKey) {
				setIsLoading(false);
				setIsFetched(true);
			}
		}
	};

	const handleStreamEvent = (event: any, requestKey = getRequestKey()) => {
		if (requestKeyRef.current !== requestKey) return;
		if (event.type === "debug") {
			console.log(`[trace-analysis] ${event.stage}`, event.payload);
			return;
		}
		if (event.type === "step") {
			upsertStep({
				label: event.label,
				status: event.status || "active",
				detail: event.detail,
			});
			return;
		}
		if (event.type === "delta") {
			return;
		}
		if (event.type === "dimension") {
			setStreamedAnalysis((current) => {
				const next = current || emptyTraceAnalysis("");
				return {
					...next,
					[event.dimension]: normalizeFindings(event.findings),
				};
			});
			return;
		}
		if (event.type === "done") {
			const runs = (event.data?.runs || []) as TraceAnalysisRunResponse[];
			const latestRun = runs[runs.length - 1];
			setAnalysis({ data: event.data });
			setStreamedAnalysis(null);
			setSelectedRunId(latestRun?.id || null);
			setSteps((prev) => prev.map((step) => ({ ...step, status: "complete" })));
			posthog?.capture(CLIENT_EVENTS.AI_ANALYSIS_RUN_SUCCESS, {
				spanId,
				scope,
				runId: latestRun?.id,
				runCount: runs.length,
			});
			return;
		}
		if (event.type === "error") {
			throw new Error(event.error || m.TRACE_AI_RUN_FAILED);
		}
	};

	const runAnalysis = async () => {
		const requestKey = getRequestKey();
		requestKeyRef.current = requestKey;
		setIsLoading(true);
		setStreamedAnalysis(emptyTraceAnalysis(""));
		setSelectedRunId("streaming");
		setSteps([]);

		const abortController = new AbortController();
		const timeoutId = setTimeout(() => abortController.abort(), 120_000);

		try {
			const scopeParam = scope === "span" ? "?scope=span" : "";
			const res = await fetch(`/api/chat/improvement/${spanId}${scopeParam}`, {
				method: "POST",
				signal: abortController.signal,
			});
			if (!res.ok || !res.body) {
				const err = await res.json();
				throw new Error(typeof err === "string" ? err : m.TRACE_AI_RUN_FAILED);
			}

			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";

			while (true) {
				const { value, done } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";
				for (const line of lines) {
					if (!line.trim()) continue;
					handleStreamEvent(JSON.parse(line), requestKey);
				}
			}

			if (buffer.trim()) {
				handleStreamEvent(JSON.parse(buffer), requestKey);
			}
		} catch (err: any) {
			if (requestKeyRef.current !== requestKey) return;
			if (err?.name === "AbortError") {
				posthog?.capture(CLIENT_EVENTS.AI_ANALYSIS_RUN_FAILURE, {
					spanId,
					scope,
					error: "timeout",
				});
				toast.error(m.TRACE_AI_TIMEOUT, {
					id: "trace-improvement",
				});
				setSelectedRunId(null);
			} else {
				posthog?.capture(CLIENT_EVENTS.AI_ANALYSIS_RUN_FAILURE, {
					spanId,
					scope,
					error: err?.message || m.TRACE_AI_RUN_FAILED,
				});
				toast.error(err?.message || m.TRACE_AI_RUN_FAILED, {
					id: "trace-improvement",
				});
			}
		} finally {
			clearTimeout(timeoutId);
			if (requestKeyRef.current === requestKey) {
				setIsLoading(false);
				setIsFetched(true);
			}
		}
	};

	useEffect(() => {
		const requestKey = getRequestKey(spanId, scope);
		requestKeyRef.current = requestKey;
		setAnalysis(null);
		setStreamedAnalysis(null);
		setSelectedRunId(null);
		setIsFetched(false);
		setSteps([]);
		if (spanId) fetchAnalysis(spanId, scope, requestKey);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [spanId, scope]);

	const persistedRuns = useMemo<AnalysisRun[]>(() => {
		const runs = analysis?.data?.runs || [];
		return runs
			.map((run) => {
				const parsed = parseAnalysisMessage(run.analysisJson);
				if (!parsed) return null;
				return {
					id: run.id,
					label: m.TRACE_AI_RUN_LABEL(run.runNumber),
					createdAt: run.createdAt,
					promptTokens: run.promptTokens,
					completionTokens: run.completionTokens,
					cost: run.cost,
					analysis: parsed,
				};
			})
			.filter(Boolean) as AnalysisRun[];
	}, [analysis]);

	const runs = useMemo<AnalysisRun[]>(() => {
		const all = [...persistedRuns];
		if (isLoading && streamedAnalysis) {
			all.push({
				id: "streaming",
				label: m.TRACE_AI_RUNNING_LABEL,
				analysis: streamedAnalysis,
			});
		}
		return all;
	}, [isLoading, persistedRuns, streamedAnalysis]);

	useEffect(() => {
		if (!selectedRunId && runs.length > 0) {
			setSelectedRunId(runs[runs.length - 1].id);
		}
	}, [runs, selectedRunId]);

	const selectedRun = useMemo(
		() => runs.find((run) => run.id === selectedRunId) || runs[runs.length - 1],
		[runs, selectedRunId]
	);

	const parsedAnalysis = selectedRun?.analysis || null;
	const parsedTotals = parsedAnalysis?.totals || emptyTraceAnalysis("").totals;

	const onSpanClick = (targetSpanId: string) => {
		updateRequest({ spanId: targetSpanId });
	};

	const onTryInChat = (finding: TraceAnalysisFinding) => {
		const message = [
			m.TRACE_AI_CHAT_PROMPT_INTRO,
			"",
			`${m.TRACE_AI_CHAT_PROMPT_SPANS} ${finding.span_refs.join(", ")}`,
			`${m.TRACE_AI_CHAT_PROMPT_ISSUE} ${finding.summary}`,
			`${m.TRACE_AI_CHAT_PROMPT_DETAILS} ${finding.detail}`,
			"",
			m.TRACE_AI_CHAT_PROMPT_SUGGESTED_FIX,
			finding.suggested_fix || "",
		].join("\n");
		navigator.clipboard.writeText(message).catch(() => {});
		toast.success(m.TRACE_AI_CHAT_PROMPT_COPIED, { id: "try-in-chat" });
		router.push("/chat");
	};

	return (
		<div className="flex h-full flex-col bg-white dark:bg-stone-950 w-full">
			<div className="flex shrink-0 items-center justify-between gap-3 border-b border-stone-200 bg-stone-50 px-3 py-2 dark:border-stone-800 dark:bg-stone-900">
				<div className="flex min-w-0 items-center gap-2">
					<Sparkles className="h-4 w-4 shrink-0 text-primary" />
					<div className="min-w-0">
						<div className="truncate text-sm font-semibold text-stone-900 dark:text-stone-100">
							{title || m.TRACE_AI_IMPROVEMENT_TITLE}
						</div>
						<div className="truncate text-xs text-stone-500 dark:text-stone-400">
							{description || m.TRACE_AI_IMPROVEMENT_DESCRIPTION}
						</div>
					</div>
				</div>
				<Button
					size="xs"
					variant="outline"
					onClick={runAnalysis}
					disabled={isLoading}
					className="shrink-0 gap-1.5"
				>
					<RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
					{persistedRuns.length > 0 ? m.TRACE_AI_RERUN : m.TRACE_AI_ANALYZE}
				</Button>
			</div>

			<div className="min-h-0 flex-1 overflow-auto bg-white px-4 py-2 dark:bg-stone-950">
				<AnalysisProgress
					steps={steps}
					isLoading={isLoading}
					title={m.TRACE_AI_IMPROVEMENT_FLOW}
				/>

				{parsedAnalysis ? (
					<>
						<div className="space-y-3 py-3">
							{runs.length > 1 && (
								<div className="flex gap-1 overflow-auto">
									{runs.map((run) => (
										<button
											key={run.id}
											onClick={() => setSelectedRunId(run.id)}
											className={`shrink-0 rounded-md border px-2.5 py-1 text-xs transition-colors ${
												selectedRun?.id === run.id
													? "border-primary bg-primary/10 text-primary"
													: "border-stone-200 text-stone-600 hover:bg-stone-100 dark:border-stone-800 dark:text-stone-300 dark:hover:bg-stone-800"
											}`}
										>
											{run.label}
											{run.createdAt ? (
												<span className="ml-1 text-stone-400">
													{new Date(run.createdAt).toLocaleTimeString()}
												</span>
											) : null}
										</button>
									))}
								</div>
							)}
							{(() => {
								const prevRun = selectedRun
									? persistedRuns[persistedRuns.findIndex((r) => r.id === selectedRun.id) - 1]
									: undefined;
								if (!prevRun) return null;
								const trend = computeTrend(parsedAnalysis!, prevRun.analysis);
								return (
									<div className="flex flex-wrap items-center gap-3 rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-xs dark:border-stone-800 dark:bg-stone-900/60">
										<span className="font-medium text-stone-500 dark:text-stone-400">{m.TRACE_AI_TREND_VS_PREVIOUS}</span>
										{trend.newFindings > 0 && (
											<span className="flex items-center gap-1 text-red-600 dark:text-red-400">
												<TrendingUp className="h-3 w-3" />
												{m.TRACE_AI_TREND_NEW(trend.newFindings)}
											</span>
										)}
										{trend.resolvedFindings > 0 && (
											<span className="flex items-center gap-1 text-green-600 dark:text-green-400">
												<TrendingDown className="h-3 w-3" />
												{m.TRACE_AI_TREND_RESOLVED(trend.resolvedFindings)}
											</span>
										)}
										{trend.newFindings === 0 && trend.resolvedFindings === 0 && (
											<span className="text-stone-400">{m.TRACE_AI_TREND_NO_CHANGES}</span>
										)}
										{trend.costDelta !== 0 && (
											<span className={trend.costDelta > 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}>
												{m.TRACE_AI_TREND_COST(`${trend.costDelta > 0 ? "+" : ""}$${trend.costDelta.toFixed(6)}`)}
											</span>
										)}
									</div>
								);
							})()}

							<div className="rounded-md border border-stone-200 bg-stone-50 p-3 dark:border-stone-800 dark:bg-stone-900/60">
								<div className="flex flex-wrap items-center gap-3 text-xs text-stone-500 dark:text-stone-400">
									<span className="font-mono text-stone-700 dark:text-stone-300">
										{parsedAnalysis.trace_id || m.TRACE_AI_FALLBACK_TRACE_LABEL}
									</span>
									<span>{m.TRACE_AI_SPAN_COUNT(parsedTotals.span_count)}</span>
									<span>{m.TRACE_AI_TOKEN_COUNT(parsedTotals.total_tokens)}</span>
									<span>${parsedTotals.total_cost_usd.toFixed(6)}</span>
									<span>{m.TRACE_AI_DURATION_MS(parsedTotals.duration_ms.toFixed(0))}</span>
								</div>
								<p className="mt-2 text-sm leading-relaxed text-stone-800 dark:text-stone-100">
									{parsedAnalysis.summary || m.TRACE_AI_ANALYSIS_RUNNING}
								</p>
							</div>

							<Tabs defaultValue="strengths" className="w-full">
								<TabsList className="h-auto flex w-full justify-start overflow-auto rounded-none bg-transparent p-0 dark:bg-transparent shrink-0 openlit-scrollbar">
									{TRACE_ANALYSIS_DIMENSIONS.map((dimension) => (
										<TabsTrigger
											key={dimension}
											value={dimension}
											className="rounded-none border-b border-transparent px-3 py-2 text-xs data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none dark:data-[state=active]:bg-transparent"
										>
											{TRACE_ANALYSIS_DIMENSION_LABELS[dimension]}
											<span className="ml-1 rounded bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-600 dark:bg-stone-800 dark:text-stone-300">
												{getDimensionFindings(parsedAnalysis, dimension).length}
											</span>
										</TabsTrigger>
									))}
								</TabsList>
								{TRACE_ANALYSIS_DIMENSIONS.map((dimension: TraceAnalysisDimension) => (
									<TabsContent key={dimension} value={dimension} className="mt-3 space-y-2">
										{getDimensionFindings(parsedAnalysis, dimension).length === 0 ? (
											<div className="rounded-md border border-stone-200 bg-stone-50 p-4 dark:border-stone-800 dark:bg-stone-900/60">
												<div className="text-sm font-semibold text-stone-800 dark:text-stone-100">
													{EMPTY_DIMENSION_COPY[dimension].summary}
												</div>
												<Accordion type="single" collapsible className="mt-2">
													<AccordionItem value="detail" className="border-0">
														<AccordionTrigger className="py-1 text-xs font-medium text-stone-500 hover:no-underline dark:text-stone-400">
															{m.TRACE_AI_DETAILS}
														</AccordionTrigger>
														<AccordionContent className="pb-0 text-sm text-stone-600 dark:text-stone-300">
															{EMPTY_DIMENSION_COPY[dimension].detail}
														</AccordionContent>
													</AccordionItem>
												</Accordion>
											</div>
										) : (
											getDimensionFindings(parsedAnalysis, dimension).map((finding) => (
												<FindingCard
													key={finding.id}
													finding={finding}
													onSpanClick={onSpanClick}
													onTryInChat={onTryInChat}
												/>
											))
										)}
									</TabsContent>
								))}
							</Tabs>
						</div>
						{selectedRun &&
							((selectedRun.promptTokens || 0) > 0 ||
								(selectedRun.cost || 0) > 0) && (
								<div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-stone-500 dark:text-stone-400">
									{selectedRun.promptTokens ? (
										<span className="flex items-center gap-1">
											<Database className="h-3 w-3" />
											{selectedRun.promptTokens +
												(selectedRun.completionTokens || 0)}{" "}
											{m.CHAT_TOKENS}
										</span>
									) : null}
									{selectedRun.cost ? (
										<span className="flex items-center gap-1">
											<Coins className="h-3 w-3" />$
											{selectedRun.cost.toFixed(6)}
										</span>
									) : null}
								</div>
							)}
					</>
				) : (
					<div className="flex min-h-full flex-col items-center justify-center gap-3 text-center">
						<div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
							<Sparkles className="h-5 w-5 text-primary" />
						</div>
						<div>
							<div className="text-sm font-semibold text-stone-900 dark:text-stone-100">
								{m.TRACE_AI_EMPTY_TITLE}
							</div>
							<div className="mt-1 max-w-[320px] text-xs leading-5 text-stone-500 dark:text-stone-400">
								{m.TRACE_AI_EMPTY_DESCRIPTION}
							</div>
						</div>
						<Button
							size="sm"
							onClick={runAnalysis}
							disabled={isLoading || !isFetched}
							className="gap-1.5"
						>
							{isLoading ? (
								<Loader2 className="h-3.5 w-3.5 animate-spin" />
							) : (
								<Circle className="h-3.5 w-3.5" />
							)}
							{m.TRACE_AI_ANALYZE_TRACE}
						</Button>
					</div>
				)}
			</div>
		</div>
	);
}
