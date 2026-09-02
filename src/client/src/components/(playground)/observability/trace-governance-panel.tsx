"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
	AlertTriangle,
	Download,
	Shield,
	ShieldAlert,
	ShieldCheck,
	ShieldQuestion,
} from "lucide-react";
import { usePostHog } from "posthog-js/react";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import getMessage from "@/constants/messages";
import { CLIENT_EVENTS } from "@/constants/events";
import { governanceReportEventProps } from "@/helpers/client/governance-analytics";
import { cn } from "@/lib/utils";
import type {
	GovernanceFinding,
	GovernanceSeverity,
	TraceGovernanceReport,
} from "@/types/governance-report";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

type SeverityFilter = "all" | GovernanceSeverity;

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
			return <ShieldAlert className="h-4 w-4" />;
		case "minor":
		case "info":
			return <ShieldQuestion className="h-4 w-4" />;
		default:
			return <ShieldCheck className="h-4 w-4" />;
	}
}

function severityClass(severity: GovernanceSeverity): string {
	switch (severity) {
		case "critical":
			return "border-red-300 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200";
		case "major":
			return "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200";
		case "minor":
			return "border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-900/40 dark:bg-yellow-950/30 dark:text-yellow-100";
		default:
			return "border-stone-200 bg-stone-50 text-stone-700 dark:border-stone-700 dark:bg-stone-900/40 dark:text-stone-200";
	}
}

function FindingCard({
	finding,
	onSelectSpan,
}: {
	finding: GovernanceFinding;
	onSelectSpan?: (spanId: string) => void;
}) {
	return (
		<div
			className={cn(
				"rounded-md border px-3 py-2 text-xs",
				severityClass(finding.severity)
			)}
		>
			<div className="flex items-start gap-2">
				<AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
				<div className="min-w-0 flex-1">
					<p className="font-medium">{finding.summary}</p>
					<p className="mt-1 text-[11px] opacity-90">{finding.detail}</p>
					{finding.span_refs.length > 0 && (
						<div className="mt-2 flex flex-wrap gap-1">
							{finding.span_refs.map((spanId) => (
								<Button
									key={spanId}
									type="button"
									variant="outline"
									size="sm"
									className="h-6 px-2 text-[10px]"
									onClick={() => onSelectSpan?.(spanId)}
								>
									{getMessage().GOVERNANCE_SPAN_REF}: {spanId.slice(0, 8)}
								</Button>
							))}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

function GovernanceLoadingSkeleton() {
	return (
		<div className="flex flex-col gap-3 p-3">
			<Skeleton className="h-14 w-full rounded-md" />
			<div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
				{Array.from({ length: 8 }).map((_, index) => (
					<Skeleton key={index} className="h-12 rounded-md" />
				))}
			</div>
			<Skeleton className="h-24 w-full rounded-md" />
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
	const { fireRequest, loading, data, error } = useFetchWrapper();
	const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");

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
		const qs = params.size ? `?${params.toString()}` : "";
		fireRequest({
			requestType: "GET",
			url: `/api/telemetry/request/span/${hierarchySpanId}/governance${qs}`,
		});
	}, [fireRequest, hierarchySpanId, traceId]);

	useEffect(() => {
		posthog?.capture(CLIENT_EVENTS.GOVERNANCE_TAB_VIEWED, {
			span_id: hierarchySpanId,
			trace_id: traceId,
		});
	}, [posthog, hierarchySpanId, traceId]);

	useEffect(() => {
		load();
	}, [load]);

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
		return [
			{ label: m.GOVERNANCE_HARNESS_SPANS, value: h.span_count },
			{ label: m.GOVERNANCE_HARNESS_DEPTH, value: h.max_depth },
			{ label: m.GOVERNANCE_HARNESS_LLM, value: h.llm_call_count },
			{ label: m.GOVERNANCE_HARNESS_TOOLS, value: h.tool_call_count },
			{ label: m.GOVERNANCE_HARNESS_RETRIEVAL, value: h.retrieval_call_count },
			{ label: m.GOVERNANCE_HARNESS_ERRORS, value: h.error_count },
			{
				label: m.GOVERNANCE_HARNESS_COST,
				value: `$${h.total_cost_usd.toFixed(4)}`,
			},
			{
				label: m.GOVERNANCE_HARNESS_DURATION,
				value: `${Math.round(h.total_duration_ms)}ms`,
			},
		];
	}, [report, m]);

	const filteredSecurity = useMemo(() => {
		if (!report) return [];
		if (severityFilter === "all") return report.security;
		return report.security.filter((finding) => finding.severity === severityFilter);
	}, [report, severityFilter]);

	const exportReport = useCallback(() => {
		if (!report) return;
		const blob = new Blob([JSON.stringify(report, null, 2)], {
			type: "application/json",
		});
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = `governance-${report.trace_id || hierarchySpanId}.json`;
		anchor.click();
		URL.revokeObjectURL(url);
	}, [report, hierarchySpanId]);

	const severityFilters: Array<{ key: SeverityFilter; label: string }> = [
		{ key: "all", label: m.GOVERNANCE_FILTER_ALL },
		{ key: "critical", label: m.GOVERNANCE_FILTER_CRITICAL },
		{ key: "major", label: m.GOVERNANCE_FILTER_MAJOR },
		{ key: "minor", label: m.GOVERNANCE_FILTER_MINOR },
	];

	if (loading && !report) {
		return <GovernanceLoadingSkeleton />;
	}

	if (error) {
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
				{m.GOVERNANCE_EMPTY_DESCRIPTION}
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-4 p-3 text-sm">
			<div
				className={cn(
					"flex items-center gap-2 rounded-md border px-3 py-2",
					severityClass(
						report.risk_level === "none" ? "info" : report.risk_level
					)
				)}
			>
				<Shield className="h-4 w-4 shrink-0" />
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2 font-medium">
						{riskIcon(report.risk_level)}
						{riskLabel(report.risk_level)}
					</div>
					<p className="mt-1 text-xs opacity-90">{report.summary}</p>
					{report.analysis_limited && (
						<p className="mt-1 text-[11px] opacity-80">{m.GOVERNANCE_TRUNCATED_NOTE}</p>
					)}
				</div>
				<div className="flex shrink-0 flex-col gap-1 sm:flex-row">
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={exportReport}
					>
						<Download className="mr-1 h-3.5 w-3.5" />
						{m.GOVERNANCE_EXPORT_JSON}
					</Button>
					<Button type="button" variant="outline" size="sm" onClick={load}>
						{m.GOVERNANCE_REFRESH}
					</Button>
				</div>
			</div>

			<section>
				<h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
					{m.GOVERNANCE_SECTION_HARNESS}
				</h3>
				<div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
					{harnessRows.map((row) => (
						<div
							key={row.label}
							className="rounded-md border border-stone-200 bg-stone-50 px-2 py-1.5 dark:border-stone-800 dark:bg-stone-900/40"
						>
							<div className="text-[10px] text-stone-500">{row.label}</div>
							<div className="text-sm font-medium">{row.value}</div>
						</div>
					))}
				</div>
				{report.harness.agent_loop && (
					<p className="mt-2 text-xs text-violet-700 dark:text-violet-300">
						{m.GOVERNANCE_AGENT_LOOP_PREFIX}: {report.harness.agent_loop.tool_name} ×
						{report.harness.agent_loop.count}
					</p>
				)}
			</section>

			{report.rules.length > 0 && (
				<section>
					<h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
						{m.GOVERNANCE_SECTION_RULES} ({report.rules.length})
					</h3>
					<div className="space-y-2">
						{report.rules.slice(0, 40).map((rule, index) => (
							<div
								key={`${rule.rule_id}:${rule.span_id}:${index}`}
								className="rounded-md border border-stone-200 px-3 py-2 text-xs dark:border-stone-800"
							>
								<div className="flex flex-wrap items-center gap-2">
									<span className="font-medium">
										{rule.rule_name || rule.rule_id}
									</span>
									<Button
										type="button"
										variant="outline"
										size="sm"
										className="h-6 px-2 text-[10px]"
										onClick={() => onSelectSpan?.(rule.span_id)}
									>
										{m.GOVERNANCE_SPAN_REF}: {rule.span_id.slice(0, 8)}
									</Button>
									<Link
										href={`/rule-engine/${rule.rule_id}`}
										className="text-[10px] text-primary hover:underline"
									>
										{m.GOVERNANCE_RULE_LINK}
									</Link>
								</div>
								{rule.entities.length > 0 && (
									<p className="mt-1 text-[11px] text-stone-500">
										{rule.entities
											.map((e) => `${e.entity_type}:${e.entity_id}`)
											.join(", ")}
									</p>
								)}
							</div>
						))}
					</div>
				</section>
			)}

			{report.security.length > 0 && (
				<section>
					<div className="mb-2 flex flex-wrap items-center justify-between gap-2">
						<h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
							{m.GOVERNANCE_SECTION_SECURITY} ({report.security.length})
						</h3>
						<div className="flex flex-wrap gap-1">
							{severityFilters.map((filter) => (
								<Button
									key={filter.key}
									type="button"
									variant={
										severityFilter === filter.key ? "default" : "outline"
									}
									size="sm"
									className="h-6 px-2 text-[10px]"
									onClick={() => setSeverityFilter(filter.key)}
								>
									{filter.label}
								</Button>
							))}
						</div>
					</div>
					<div className="space-y-2">
						{filteredSecurity.length === 0 ? (
							<p className="text-xs text-stone-500">{m.GOVERNANCE_EMPTY_TITLE}</p>
						) : (
							filteredSecurity.map((finding) => (
								<FindingCard
									key={finding.id}
									finding={finding}
									onSelectSpan={onSelectSpan}
								/>
							))
						)}
					</div>
				</section>
			)}

			{report.evaluations.length > 0 && (
				<section>
					<div className="mb-2 flex flex-wrap items-center justify-between gap-2">
						<h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
							{m.GOVERNANCE_SECTION_EVALUATIONS} ({report.evaluations.length})
						</h3>
						<Link
							href="/evaluations"
							className="text-[10px] text-primary hover:underline"
						>
							{m.GOVERNANCE_EVALUATIONS_LINK}
						</Link>
					</div>
					<div className="space-y-2">
						{report.evaluations.slice(0, 30).map((row, index) => (
							<div
								key={`${row.span_id}:${row.evaluation_type}:${index}`}
								className="rounded-md border border-stone-200 px-3 py-2 text-xs dark:border-stone-800"
							>
								<div className="flex flex-wrap items-center gap-2">
									<span className="font-medium">{row.evaluation_type}</span>
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
										className="h-6 px-2 text-[10px]"
										onClick={() => onSelectSpan?.(row.span_id)}
									>
										{m.GOVERNANCE_SPAN_REF}: {row.span_id.slice(0, 8)}
									</Button>
								</div>
								{row.explanation && (
									<p className="mt-1 text-[11px] text-stone-500">
										{row.explanation}
									</p>
								)}
							</div>
						))}
					</div>
				</section>
			)}

			{report.finding_count === 0 &&
				report.rule_match_count === 0 &&
				report.evaluations.length === 0 && (
					<div className="py-6 text-center text-sm text-stone-500">
						<p className="font-medium">{m.GOVERNANCE_EMPTY_TITLE}</p>
						<p className="mt-1 text-xs">{m.GOVERNANCE_EMPTY_DESCRIPTION}</p>
					</div>
				)}
		</div>
	);
}
