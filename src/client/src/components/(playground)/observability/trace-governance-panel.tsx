"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
	AlertTriangle,
	ChevronDown,
	ChevronRight,
	Copy,
	Download,
	RefreshCw,
	ShieldAlert,
	ShieldCheck,
	ShieldQuestion,
	Sparkles,
} from "lucide-react";
import { usePostHog } from "posthog-js/react";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import getMessage from "@/constants/messages";
import { CLIENT_EVENTS } from "@/constants/events";
import { governanceReportEventProps } from "@/helpers/client/governance-analytics";
import { getCurrentProjectEnvironment } from "@/selectors/project";
import { useRootStore } from "@/store";
import { cn } from "@/lib/utils";
import type {
	GovernanceFinding,
	GovernanceFindingCategory,
	GovernanceSeverity,
	TraceGovernanceReport,
} from "@/types/governance-report";
import {
	buildAgentLoopKnowledgeRule,
	buildAgentLoopOtterPrompt,
} from "@/lib/platform/governance/agent-loop-fix";
import AskOtterPanel from "@/components/(playground)/chat/ask-otter-panel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

type SeverityFilter = "all" | GovernanceSeverity;

const FINDING_PAGE_SIZE = 20;

function riskLabel(level: TraceGovernanceReport["risk_level"]): string {
	const m = getMessage();
	switch (level) {
		case "critical":
			return m.GOVERNANCE_RISK_CRITICAL;
		case "major":
			return m.GOVERNANCE_RISK_MAJOR;
		case "minor":
			return m.GOVERNANCE_RISK_MINOR;
		case "info":
			return m.GOVERNANCE_RISK_INFO;
		default:
			return m.GOVERNANCE_RISK_NONE;
	}
}

function riskIcon(level: TraceGovernanceReport["risk_level"]) {
	switch (level) {
		case "critical":
		case "major":
			return <ShieldAlert className="h-3.5 w-3.5" />;
		case "minor":
		case "info":
			return <ShieldQuestion className="h-3.5 w-3.5" />;
		default:
			return <ShieldCheck className="h-3.5 w-3.5" />;
	}
}

/** Left border accent only — keeps the panel body neutral. */
function severityBorder(severity: GovernanceSeverity | "none"): string {
	switch (severity) {
		case "critical":
			return "border-l-red-500";
		case "major":
			return "border-l-amber-500";
		case "minor":
			return "border-l-yellow-400";
		case "info":
			return "border-l-stone-400";
		default:
			return "border-l-stone-300 dark:border-l-stone-600";
	}
}

/** Compact tint for finding headers / risk badge only. */
function severityHeader(severity: GovernanceSeverity): string {
	switch (severity) {
		case "critical":
			return "bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-100";
		case "major":
			return "bg-amber-50 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100";
		case "minor":
			return "bg-yellow-50/80 text-yellow-950 dark:bg-yellow-950/30 dark:text-yellow-100";
		default:
			return "bg-stone-50 text-stone-800 dark:bg-stone-900/60 dark:text-stone-200";
	}
}

function severityBadge(severity: GovernanceSeverity | "none"): string {
	switch (severity) {
		case "critical":
			return "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-200";
		case "major":
			return "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200";
		case "minor":
			return "bg-yellow-100 text-yellow-900 dark:bg-yellow-950/50 dark:text-yellow-200";
		case "info":
			return "bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300";
		default:
			return "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300";
	}
}

function categoryLabel(category: GovernanceFindingCategory): string {
	const m = getMessage();
	switch (category) {
		case "agent_loop":
			return m.GOVERNANCE_CATEGORY_AGENT_LOOP;
		case "policy":
			return m.GOVERNANCE_CATEGORY_POLICY;
		case "coding_agent":
			return m.GOVERNANCE_CATEGORY_CODING_AGENT;
		case "span_error":
			return m.GOVERNANCE_CATEGORY_SPAN_ERROR;
		case "generation_health":
			return m.GOVERNANCE_CATEGORY_GENERATION_HEALTH;
		case "harness":
			return m.GOVERNANCE_CATEGORY_HARNESS;
		case "evaluation":
			return m.GOVERNANCE_CATEGORY_EVALUATION;
		case "prompt_injection":
			return m.GOVERNANCE_CATEGORY_PROMPT_INJECTION;
		case "tool_misuse":
			return m.GOVERNANCE_CATEGORY_TOOL_MISUSE;
		default:
			return category;
	}
}

function formatDurationMs(ms: number): string {
	if (!Number.isFinite(ms) || ms <= 0) return "0ms";
	if (ms < 1000) return `${Math.round(ms)}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	const minutes = Math.floor(ms / 60_000);
	const seconds = Math.round((ms % 60_000) / 1000);
	return `${minutes}m ${seconds}s`;
}

function FindingCard({
	finding,
	onSelectSpan,
}: {
	finding: GovernanceFinding;
	onSelectSpan?: (spanId: string) => void;
}) {
	const m = getMessage();
	const [open, setOpen] = useState(false);
	const [askOtterOpen, setAskOtterOpen] = useState(false);
	const [copiedRule, setCopiedRule] = useState(false);
	const isAgentLoop = finding.category === "agent_loop";
	const evidenceEntries = Object.entries(finding.evidence || {}).filter(
		([key, value]) => {
			if (value === undefined || value === "") return false;
			if (
				(key === "wasted_tokens" || key === "wasted_cost") &&
				finding.evidence?.usage_reported === false
			) {
				return false;
			}
			return true;
		}
	);

	const copyAgentRule = useCallback(async () => {
		const text = buildAgentLoopKnowledgeRule(finding);
		try {
			await navigator.clipboard.writeText(text);
			setCopiedRule(true);
			window.setTimeout(() => setCopiedRule(false), 2000);
		} catch {
			setCopiedRule(false);
		}
	}, [finding]);

	return (
		<div
			className={cn(
				"overflow-hidden rounded-md border border-stone-200 border-l-4 bg-white dark:border-stone-800 dark:bg-stone-950",
				severityBorder(finding.severity)
			)}
		>
			<button
				type="button"
				className={cn(
					"flex w-full items-start gap-2 px-2.5 py-2 text-left",
					severityHeader(finding.severity)
				)}
				onClick={() => setOpen((value) => !value)}
				aria-expanded={open}
			>
				{open ? (
					<ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-70" />
				) : (
					<ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-70" />
				)}
				<AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-80" />
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-1.5">
						<span className="text-[10px] font-medium uppercase tracking-wide opacity-80">
							{categoryLabel(finding.category)}
						</span>
						<span
							className={cn(
								"rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
								severityBadge(finding.severity)
							)}
						>
							{finding.severity}
						</span>
					</div>
					<p className="mt-0.5 text-xs font-medium text-stone-900 dark:text-stone-100">
						{finding.summary}
					</p>
					{finding.resource && (
						<p className="mt-0.5 truncate font-mono text-[11px] text-stone-600 dark:text-stone-400">
							{finding.resource}
						</p>
					)}
				</div>
			</button>
			{open && (
				<div className="space-y-2 border-t border-stone-200 bg-white px-2.5 py-2 text-[11px] text-stone-700 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300">
					<p>{finding.detail}</p>
					{finding.remediation && (
						<div>
							<p className="font-medium text-stone-500 dark:text-stone-400">
								{m.GOVERNANCE_FINDING_FIX}
							</p>
							<p className="mt-0.5">{finding.remediation}</p>
							{isAgentLoop && (
								<div className="mt-1.5 flex flex-wrap gap-1.5">
									<Button
										type="button"
										variant="outline"
										size="sm"
										className="h-7 gap-1 px-2 text-[10px]"
										onClick={copyAgentRule}
									>
										<Copy className="h-3 w-3" />
										{copiedRule
											? m.GOVERNANCE_COPY_AGENT_RULE_DONE
											: m.GOVERNANCE_COPY_AGENT_RULE}
									</Button>
									<Button
										type="button"
										variant={askOtterOpen ? "secondary" : "outline"}
										size="sm"
										className="h-7 gap-1 px-2 text-[10px]"
										onClick={() => setAskOtterOpen((value) => !value)}
									>
										<Sparkles className="h-3 w-3" />
										{askOtterOpen
											? m.GOVERNANCE_ASK_OTTER_HIDE
											: m.GOVERNANCE_ASK_OTTER_FIX}
									</Button>
								</div>
							)}
						</div>
					)}
					{isAgentLoop && askOtterOpen && (
						<div className="overflow-hidden rounded-md border border-stone-200 dark:border-stone-800">
							<AskOtterPanel
								layout="dock"
								defaultQuestion={m.GOVERNANCE_ASK_OTTER_DEFAULT_QUESTION}
								contextLabel={
									typeof finding.evidence?.tool_name === "string"
										? finding.evidence.tool_name
										: finding.resource || undefined
								}
								copy={{
									title: m.GOVERNANCE_ASK_OTTER_TITLE,
									empty: m.GOVERNANCE_ASK_OTTER_EMPTY,
									placeholder: m.GOVERNANCE_ASK_OTTER_PLACEHOLDER,
									hint: m.GOVERNANCE_ASK_OTTER_HINT,
									send: m.GOVERNANCE_ASK_OTTER_SEND,
									conversationTitle: m.GOVERNANCE_ASK_OTTER_TITLE,
								}}
								buildPrompt={(question) =>
									buildAgentLoopOtterPrompt(question, finding)
								}
							/>
						</div>
					)}
					{evidenceEntries.length > 0 && (
						<p className="font-mono text-[10px] text-stone-500 dark:text-stone-400">
							{evidenceEntries
								.map(([key, value]) => `${key}=${String(value)}`)
								.join(" · ")}
						</p>
					)}
					{finding.span_refs.length > 0 && (
						<div className="flex flex-wrap gap-1">
							{finding.span_refs.slice(0, 8).map((spanId) => (
								<Button
									key={spanId}
									type="button"
									variant="outline"
									size="sm"
									className="h-6 px-2 font-mono text-[10px]"
									onClick={() => onSelectSpan?.(spanId)}
								>
									{spanId.slice(0, 8)}
								</Button>
							))}
							{finding.span_refs.length > 8 && (
								<span className="self-center text-[10px] text-stone-500">
									+{finding.span_refs.length - 8}
								</span>
							)}
						</div>
					)}
				</div>
			)}
		</div>
	);
}

function GovernanceLoadingSkeleton() {
	return (
		<div className="flex flex-col gap-2 p-3">
			<Skeleton className="h-10 w-full rounded-md" />
			<Skeleton className="h-16 w-full rounded-md" />
			<Skeleton className="h-20 w-full rounded-md" />
		</div>
	);
}

export default function TraceGovernancePanel({
	hierarchySpanId,
	traceId,
	onSelectSpan,
}: {
	hierarchySpanId: string;
	traceId?: string;
	onSelectSpan?: (spanId: string) => void;
}) {
	const m = getMessage();
	const posthog = usePostHog();
	const environment = useRootStore(getCurrentProjectEnvironment);
	const { fireRequest, isLoading, data, error, reset } = useFetchWrapper();
	const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
	const [visibleCount, setVisibleCount] = useState(FINDING_PAGE_SIZE);

	const errorMessage = useMemo(() => {
		if (!error) return "";
		if (typeof error === "string") return error;
		if (typeof error === "object" && error !== null) {
			const record = error as Record<string, unknown>;
			return String(record.message || record.err || record.error || "");
		}
		return String(error);
	}, [error]);

	const load = useCallback(() => {
		const params = new URLSearchParams();
		if (traceId) params.set("traceId", traceId);
		// Explicit query param keeps connector-signal scoping obvious and avoids
		// reusing another environment's cached governance report.
		if (environment) params.set("environment", environment);
		const qs = params.size ? `?${params.toString()}` : "";
		fireRequest({
			requestType: "GET",
			url: `/api/telemetry/request/span/${hierarchySpanId}/governance${qs}`,
		});
	}, [environment, fireRequest, hierarchySpanId, traceId]);

	useEffect(() => {
		posthog?.capture(CLIENT_EVENTS.GOVERNANCE_TAB_VIEWED, {
			span_id: hierarchySpanId,
			trace_id: traceId,
			environment,
		});
	}, [posthog, hierarchySpanId, traceId, environment]);

	useEffect(() => {
		// Drop previous environment's report so production findings never linger
		// after switching connector environment.
		reset();
	}, [environment, reset]);

	useEffect(() => {
		load();
	}, [load]);

	useEffect(() => {
		setVisibleCount(FINDING_PAGE_SIZE);
	}, [severityFilter, hierarchySpanId, traceId, environment]);

	const report = (data as { report?: TraceGovernanceReport } | undefined)?.report;

	useEffect(() => {
		if (!report) return;
		posthog?.capture(
			CLIENT_EVENTS.GOVERNANCE_REPORT_LOADED,
			governanceReportEventProps({
				spanId: hierarchySpanId,
				traceId: report.trace_id,
				riskLevel: report.risk_level,
				findingCount: report.finding_count,
				ruleMatchCount: report.rule_match_count,
				evaluationCount: report.evaluations.length,
				analysisLimited: report.analysis_limited,
			})
		);
	}, [posthog, hierarchySpanId, report]);

	useEffect(() => {
		if (!error) return;
		posthog?.capture(CLIENT_EVENTS.GOVERNANCE_REPORT_LOAD_FAILURE, {
			span_id: hierarchySpanId,
			trace_id: traceId,
		});
	}, [posthog, error, hierarchySpanId, traceId]);

	const harnessRows = useMemo(() => {
		if (!report) return [];
		const h = report.harness;
		const costValue =
			h.cost_reported || h.total_cost_usd > 0
				? `$${h.total_cost_usd.toFixed(4)}`
				: m.GOVERNANCE_COST_NOT_REPORTED;
		return [
			{ label: m.GOVERNANCE_HARNESS_SPANS, value: h.span_count.toLocaleString() },
			{ label: m.GOVERNANCE_HARNESS_TOOLS, value: h.tool_call_count.toLocaleString() },
			{ label: m.GOVERNANCE_HARNESS_ERRORS, value: h.error_count.toLocaleString() },
			{ label: m.GOVERNANCE_HARNESS_COST, value: costValue },
			{
				label: m.GOVERNANCE_HARNESS_TOKENS,
				value:
					h.total_tokens > 0
						? h.total_tokens.toLocaleString()
						: m.GOVERNANCE_USAGE_NOT_REPORTED,
			},
			{
				label: m.GOVERNANCE_HARNESS_DURATION,
				value: formatDurationMs(h.total_duration_ms),
			},
		];
	}, [report, m]);

	const filteredSecurity = useMemo(() => {
		if (!report) return [];
		const sorted = [...report.security].sort((a, b) => {
			const order: Record<GovernanceSeverity, number> = {
				critical: 0,
				major: 1,
				minor: 2,
				info: 3,
			};
			return order[a.severity] - order[b.severity];
		});
		if (severityFilter === "all") return sorted;
		return sorted.filter((finding) => finding.severity === severityFilter);
	}, [report, severityFilter]);

	const visibleFindings = filteredSecurity.slice(0, visibleCount);

	const severityCounts = useMemo(() => {
		const counts: Record<SeverityFilter, number> = {
			all: report?.security.length || 0,
			critical: 0,
			major: 0,
			minor: 0,
			info: 0,
		};
		for (const finding of report?.security || []) {
			counts[finding.severity] += 1;
		}
		return counts;
	}, [report]);

	const exportReport = useCallback(async () => {
		if (!hierarchySpanId) return;
		const params = new URLSearchParams();
		if (traceId) params.set("traceId", traceId);
		if (environment) params.set("environment", environment);
		const qs = params.toString();
		const url = `/api/telemetry/request/span/${encodeURIComponent(
			hierarchySpanId
		)}/governance/export${qs ? `?${qs}` : ""}`;
		try {
			const response = await fetch(url, { credentials: "include" });
			if (!response.ok) {
				// Fall back to in-memory report if export route fails.
				if (!report) return;
				const blob = new Blob([JSON.stringify(report, null, 2)], {
					type: "application/json",
				});
				const objectUrl = URL.createObjectURL(blob);
				const anchor = document.createElement("a");
				anchor.href = objectUrl;
				anchor.download = `governance-${report.trace_id || hierarchySpanId}.json`;
				anchor.click();
				URL.revokeObjectURL(objectUrl);
				return;
			}
			const payload = await response.json();
			const blob = new Blob([JSON.stringify(payload.passport || payload, null, 2)], {
				type: "application/json",
			});
			const objectUrl = URL.createObjectURL(blob);
			const anchor = document.createElement("a");
			anchor.href = objectUrl;
			const reportId =
				payload?.passport?.report_id || report?.report_id || hierarchySpanId;
			anchor.download = `governance-passport-${reportId}.json`;
			anchor.click();
			URL.revokeObjectURL(objectUrl);
		} catch {
			if (!report) return;
			const blob = new Blob([JSON.stringify(report, null, 2)], {
				type: "application/json",
			});
			const objectUrl = URL.createObjectURL(blob);
			const anchor = document.createElement("a");
			anchor.href = objectUrl;
			anchor.download = `governance-${report.trace_id || hierarchySpanId}.json`;
			anchor.click();
			URL.revokeObjectURL(objectUrl);
		}
	}, [hierarchySpanId, traceId, environment, report]);

	const severityFilters: Array<{ key: SeverityFilter; label: string }> = [
		{ key: "all", label: m.GOVERNANCE_FILTER_ALL },
		{ key: "critical", label: m.GOVERNANCE_FILTER_CRITICAL },
		{ key: "major", label: m.GOVERNANCE_FILTER_MAJOR },
		{ key: "minor", label: m.GOVERNANCE_FILTER_MINOR },
		{ key: "info", label: m.GOVERNANCE_FILTER_INFO },
	];

	if (isLoading && !report) {
		return <GovernanceLoadingSkeleton />;
	}

	if (error && !report) {
		return (
			<div className="flex flex-col items-center gap-3 px-3 py-8">
				<div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
					<p>{m.GOVERNANCE_LOAD_FAILED}</p>
					{errorMessage && (
						<p className="mt-1 text-xs opacity-90">
							{m.GOVERNANCE_LOAD_FAILED_DETAIL.replace("{detail}", errorMessage)}
						</p>
					)}
				</div>
				<Button type="button" variant="outline" size="sm" onClick={load}>
					{m.GOVERNANCE_RETRY}
				</Button>
			</div>
		);
	}

	if (!report) {
		return (
			<div className="py-8 text-center text-sm text-stone-500">
				<p>{m.GOVERNANCE_LOADING_HINT}</p>
			</div>
		);
	}

	const hasSignals =
		report.finding_count > 0 ||
		report.rule_match_count > 0 ||
		report.evaluations.length > 0;
	const riskLevel =
		report.risk_level === "none" ? ("info" as const) : report.risk_level;

	return (
		<div className="flex flex-col gap-3 p-3 text-sm">
			<div
				className={cn(
					"flex items-start gap-2 rounded-md border border-stone-200 border-l-4 bg-white px-2.5 py-2 dark:border-stone-800 dark:bg-stone-950",
					severityBorder(riskLevel)
				)}
			>
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2">
						<span
							className={cn(
								"inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium",
								severityBadge(riskLevel)
							)}
						>
							{riskIcon(report.risk_level)}
							{riskLabel(report.risk_level)}
						</span>
						<span className="text-xs text-stone-600 dark:text-stone-400">
							{report.summary}
						</span>
					</div>
					{report.analysis_limited && (
						<p className="mt-1 text-[11px] text-stone-500">
							{m.GOVERNANCE_TRUNCATED_NOTE}
						</p>
					)}
					{report.otter_run_id && (
						<p className="mt-1 text-[11px] text-stone-500">
							{m.GOVERNANCE_OTTER_MERGED}
						</p>
					)}
					{report.report_id && (
						<p className="mt-1 font-mono text-[10px] text-stone-500">
							{m.GOVERNANCE_REPORT_ID_LABEL}: {report.report_id}
						</p>
					)}
					{report.harness.agent_loop && (
						<p className="mt-1 text-[11px] text-stone-600 dark:text-stone-400">
							{m.GOVERNANCE_AGENT_LOOP_BANNER.replace(
								"{tool}",
								report.harness.agent_loop.tool_name
							).replace("{count}", String(report.harness.agent_loop.count))}
						</p>
					)}
				</div>
				<div className="flex shrink-0 gap-1">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="h-7 px-2"
						onClick={exportReport}
						aria-label={m.GOVERNANCE_EXPORT_JSON}
						title={m.GOVERNANCE_EXPORT_JSON}
					>
						<Download className="h-3.5 w-3.5" />
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="h-7 px-2"
						onClick={load}
						aria-label={m.GOVERNANCE_REFRESH}
						title={m.GOVERNANCE_REFRESH}
					>
						<RefreshCw className="h-3.5 w-3.5" />
					</Button>
				</div>
			</div>

			<section>
				<dl className="flex flex-wrap gap-x-5 gap-y-2 rounded-md border border-stone-200 px-2.5 py-2 dark:border-stone-800">
					{harnessRows.map((row) => (
						<div key={row.label} className="min-w-0">
							<dt className="text-[10px] uppercase tracking-wide text-stone-500">
								{row.label}
							</dt>
							<dd className="mt-0.5 font-mono text-xs font-semibold tabular-nums text-stone-900 dark:text-stone-100">
								{row.value}
							</dd>
						</div>
					))}
				</dl>
				{!report.harness.cost_reported && report.harness.total_tokens > 0 && (
					<p className="mt-1.5 text-[11px] text-stone-500">
						{m.GOVERNANCE_COST_CURSOR_HINT}
					</p>
				)}
			</section>

			{report.rules.length > 0 && (
				<section>
					<h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-500">
						{m.GOVERNANCE_SECTION_RULES} ({report.rules.length})
					</h3>
					<div className="divide-y divide-stone-200 overflow-hidden rounded-md border border-stone-200 dark:divide-stone-800 dark:border-stone-800">
						{report.rules.slice(0, 20).map((rule, index) => (
							<div
								key={`${rule.rule_id}:${rule.span_id}:${index}`}
								className="flex flex-wrap items-center gap-2 px-2.5 py-1.5 text-xs"
							>
								<span className="font-medium text-stone-900 dark:text-stone-100">
									{rule.rule_name || rule.rule_id}
								</span>
								<Button
									type="button"
									variant="outline"
									size="sm"
									className="h-6 px-2 font-mono text-[10px]"
									onClick={() => onSelectSpan?.(rule.span_id)}
								>
									{rule.span_id.slice(0, 8)}
								</Button>
								<Link
									href={`/rule-engine/${rule.rule_id}`}
									className="text-[10px] text-primary hover:underline"
								>
									{m.GOVERNANCE_RULE_LINK}
								</Link>
							</div>
						))}
					</div>
				</section>
			)}

			{report.security.length > 0 && (
				<section>
					<div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
						<h3 className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">
							{m.GOVERNANCE_SECTION_SECURITY} ({report.security.length})
						</h3>
						<div className="flex flex-wrap gap-1">
							{severityFilters.map((filter) => {
								if (
									filter.key !== "all" &&
									severityCounts[filter.key] === 0
								) {
									return null;
								}
								return (
									<button
										key={filter.key}
										type="button"
										className={cn(
											"rounded px-1.5 py-0.5 text-[10px] font-medium",
											severityFilter === filter.key
												? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900"
												: "bg-stone-100 text-stone-600 hover:bg-stone-200 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800"
										)}
										onClick={() => setSeverityFilter(filter.key)}
									>
										{filter.label}
										{filter.key !== "all"
											? ` ${severityCounts[filter.key]}`
											: ""}
									</button>
								);
							})}
						</div>
					</div>
					{filteredSecurity.length === 0 ? (
						<p className="text-xs text-stone-500">{m.GOVERNANCE_FILTER_EMPTY}</p>
					) : (
						<>
							<div className="space-y-1.5">
								{visibleFindings.map((finding) => (
									<FindingCard
										key={finding.id}
										finding={finding}
										onSelectSpan={onSelectSpan}
									/>
								))}
							</div>
							{filteredSecurity.length > visibleCount && (
								<div className="mt-2 flex items-center justify-between gap-2">
									<p className="text-[11px] text-stone-500">
										{m.GOVERNANCE_SHOWING_OF.replace(
											"{shown}",
											String(visibleCount)
										).replace("{total}", String(filteredSecurity.length))}
									</p>
									<Button
										type="button"
										variant="outline"
										size="sm"
										className="h-7 text-xs"
										onClick={() =>
											setVisibleCount((count) => count + FINDING_PAGE_SIZE)
										}
									>
										{m.GOVERNANCE_SHOW_MORE}
									</Button>
								</div>
							)}
						</>
					)}
				</section>
			)}

			{(report.policy_controls?.length || 0) > 0 && (
				<section>
					<h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-500">
						{m.GOVERNANCE_SECTION_POLICY} ({report.policy_controls!.length})
					</h3>
					<div className="divide-y divide-stone-200 overflow-hidden rounded-md border border-stone-200 dark:divide-stone-800 dark:border-stone-800">
						{report.policy_controls!.map((control) => (
							<div
								key={`${control.framework}:${control.control_id}`}
								className="flex flex-col gap-0.5 px-2.5 py-1.5 text-xs"
							>
								<div className="flex flex-wrap items-center gap-2">
									<span className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[10px] uppercase text-stone-700 dark:bg-stone-800 dark:text-stone-300">
										{control.framework}
									</span>
									<span className="font-mono text-[11px] font-medium text-stone-900 dark:text-stone-100">
										{control.control_id}
									</span>
									<span className="text-stone-600 dark:text-stone-400">
										{control.title}
									</span>
								</div>
								{control.rationale ? (
									<p className="pl-0.5 text-[10px] leading-snug text-stone-500 dark:text-stone-500">
										{control.rationale}
									</p>
								) : null}
							</div>
						))}
					</div>
				</section>
			)}

			{report.evaluations.length > 0 && (
				<section>
					<div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
						<h3 className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">
							{m.GOVERNANCE_SECTION_EVALUATIONS} ({report.evaluations.length})
						</h3>
						<Link
							href="/evaluations"
							className="text-[10px] text-primary hover:underline"
						>
							{m.GOVERNANCE_EVALUATIONS_LINK}
						</Link>
					</div>
					<div className="divide-y divide-stone-200 overflow-hidden rounded-md border border-stone-200 dark:divide-stone-800 dark:border-stone-800">
						{report.evaluations.slice(0, 20).map((row, index) => (
							<div
								key={`${row.span_id}:${row.evaluation_type}:${index}`}
								className="flex flex-wrap items-center gap-2 px-2.5 py-1.5 text-xs"
							>
								<span className="font-medium text-stone-900 dark:text-stone-100">
									{row.evaluation_type}
								</span>
								{row.verdict && (
									<span className="text-stone-500">{row.verdict}</span>
								)}
								{typeof row.score === "number" && (
									<span className="text-stone-500">
										{m.GOVERNANCE_EVAL_SCORE_PREFIX} {row.score}
									</span>
								)}
								<Button
									type="button"
									variant="outline"
									size="sm"
									className="h-6 px-2 font-mono text-[10px]"
									onClick={() => onSelectSpan?.(row.span_id)}
								>
									{row.span_id.slice(0, 8)}
								</Button>
							</div>
						))}
					</div>
				</section>
			)}

			{!hasSignals && (
				<div className="py-6 text-center text-sm text-stone-500">
					<p className="font-medium">{m.GOVERNANCE_EMPTY_TITLE}</p>
					<p className="mt-1 text-xs">{m.GOVERNANCE_EMPTY_DESCRIPTION}</p>
				</div>
			)}
		</div>
	);
}
