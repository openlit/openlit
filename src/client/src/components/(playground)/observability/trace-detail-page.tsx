"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import DetailShell from "./detail-shell";
import {
	getExtraTabsContentTypes,
	normalizeTrace,
	isSyntheticSpanId,
} from "@/helpers/client/trace";
import { getTimeLimitObject } from "@/store/filter";
import { FilterConfig, FilterType, TIME_RANGES } from "@/types/store/filter";
import { useCustomBreadcrumbs } from "@/utils/hooks/useBreadcrumbs";
import { AlertTriangle, ArrowLeft, ChevronLeft, ChevronRight, Clock, Copy, Cpu, DollarSign, Info, RefreshCw, Zap } from "lucide-react";
import SpanHierarchyExplorer from "./span-hierarchy-explorer";
import { Button } from "@/components/ui/button";
import getMessage from "@/constants/messages";
import Evaluations from "@/components/(playground)/request/components/evaluations";
import { RequestProvider } from "@/components/(playground)/request/request-context";
import TraceAiAnalysisPanel from "@/components/(playground)/request/components/trace-ai-analysis-panel";
import DetailObjectTabs, { buildObjectTabs } from "./detail-object-tabs";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
	CodingAgentVendorIcon,
	hasCodingAgentVendorIcon,
} from "@/components/svg/coding-agents";
import { toast } from "sonner";

// Mirror of `durationLabel` in observability/columns.tsx — kept local
// so the top-card override for coding-agent sessions can format the
// session-level wall-clock duration the same way the Sessions list
// row does ("1.2m", "12.3s", "450ms"). Returns "" for non-positive
// inputs so the caller can fall back to the span-local duration.
function formatSessionDurationMs(ms: number): string {
	if (!Number.isFinite(ms) || ms <= 0) return "";
	if (ms < 1000) return `${ms.toFixed(0)}ms`;
	const sec = ms / 1000;
	if (sec < 60) return `${sec.toFixed(1)}s`;
	const min = sec / 60;
	if (min < 60) return `${min.toFixed(1)}m`;
	return `${(min / 60).toFixed(1)}h`;
}

// Compact inline notice when a coding-agent span was recorded with a
// non-`full` content-capture mode (CLI flag OPENLIT_CODING_CONTENT_CAPTURE).
// We surface the one command that flips it on; everything else (modes,
// scope, scrubbing guarantees) lives in the docs to keep this terse.
function ContentCaptureNote() {
	const m = getMessage();
	const command = m.CODING_AGENT_CONTENT_CAPTURE_NOTE_COMMAND;
	const onCopy = useCallback(async () => {
		try {
			await navigator.clipboard.writeText(command);
			toast.success("Copied to clipboard");
		} catch {
			// Clipboard API is gated behind a secure context. Fail
			// silently rather than throwing — the command text is
			// still selectable, and a noisy toast on every
			// HTTP-served dev instance would be worse than a no-op.
		}
	}, [command]);
	return (
		<div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200">
			<Info className="h-3 w-3 shrink-0" />
			<span className="font-medium">{m.CODING_AGENT_CONTENT_CAPTURE_NOTE_TITLE}</span>
			<code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[10px] text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
				{command}
			</code>
			<button
				type="button"
				onClick={onCopy}
				className="inline-flex items-center gap-1 rounded border border-amber-300 px-1 py-0.5 text-[10px] hover:bg-amber-100 dark:border-amber-800 dark:hover:bg-amber-900/40"
				aria-label="Copy command"
			>
				<Copy className="h-2.5 w-2.5" />
				Copy
			</button>
		</div>
	);
}

function Stat({ icon, label, value }: { icon: ReactNode; label: string; value?: string }) {
	return (
		<div className="rounded-md bg-stone-100 px-2.5 py-1.5 dark:bg-stone-900">
			<div className="flex items-center gap-1.5 text-[11px] text-stone-500 dark:text-stone-400">
				{icon}
				{label}
			</div>
			<div className="mt-0.5 truncate text-xs font-semibold text-stone-900 dark:text-stone-100">
				{value || "-"}
			</div>
		</div>
	);
}

function CostStat({
	costValue,
	spanId,
	hasModel,
	onRecalculated,
}: {
	costValue?: string;
	spanId?: string;
	hasModel: boolean;
	onRecalculated: () => void;
}) {
	const m = getMessage();
	const hasCost = !!costValue && costValue !== "-";
	const canRecalculate = hasModel && !!spanId;
	const { fireRequest, isLoading } = useFetchWrapper<{
		success: boolean;
		err?: string;
		data?: { spanId: string; cost: number };
	}>();

	const handleRecalculate = (event: React.MouseEvent) => {
		event.stopPropagation();
		if (!spanId || isLoading) return;
		fireRequest({
			requestType: "POST",
			url: `/api/pricing/${spanId}`,
			successCb: (response) => {
				if (response?.success) {
					toast.success(
						`${m.RECALCULATE_COST_SUCCESS}: $${(response.data?.cost ?? 0).toFixed(10)}`,
						{ id: "pricing-update" }
					);
					onRecalculated();
				} else {
					toast.error(response?.err || m.RECALCULATE_COST_FAILURE, {
						id: "pricing-update",
					});
				}
			},
			failureCb: (err?: string) => {
				toast.error(err || m.RECALCULATE_COST_REQUEST_FAILED, {
					id: "pricing-update",
				});
			},
		});
	};

	return (
		<div className="rounded-md bg-stone-100 px-2.5 py-1.5 dark:bg-stone-900">
			<div className="flex items-center gap-1.5 text-[11px] text-stone-500 dark:text-stone-400">
				<DollarSign className="h-3.5 w-3.5" />
				{m.OBSERVABILITY_COST}
				{canRecalculate && (
					<TooltipProvider delayDuration={200}>
						<Tooltip>
							<TooltipTrigger asChild>
								<button
									type="button"
									onClick={handleRecalculate}
									disabled={isLoading}
									className="relative ml-auto rounded p-0.5 transition-colors hover:bg-stone-200 disabled:opacity-50 dark:hover:bg-stone-700"
								>
									<RefreshCw className={`h-3 w-3 ${isLoading ? "animate-spin" : ""}`} />
									{!hasCost && !isLoading && (
										<span className="absolute -right-0.5 -top-0.5 h-2 w-2 animate-ping rounded-full bg-primary" />
									)}
								</button>
							</TooltipTrigger>
							<TooltipContent side="bottom" className="max-w-[220px] text-xs">
								{m.RECALCULATE_COST_TITLE}
							</TooltipContent>
						</Tooltip>
					</TooltipProvider>
				)}
			</div>
			<div className="mt-0.5 truncate text-xs font-semibold text-stone-900 dark:text-stone-100">
				{costValue || "-"}
			</div>
		</div>
	);
}

function MetaPill({
	label,
	value,
	icon,
}: {
	label: string;
	value?: string;
	icon?: ReactNode;
}) {
	if (!value) return null;
	return (
		<div className="min-w-0 rounded-md border border-stone-200 bg-white px-2 py-1 dark:border-stone-800 dark:bg-stone-950">
			<div className="text-[10px] uppercase tracking-wide text-stone-500 dark:text-stone-400">
				{label}
			</div>
			<div
				className="flex max-w-72 items-center gap-1.5 truncate font-mono text-[11px] font-medium text-stone-900 dark:text-stone-100"
				title={value}
			>
				{icon ? <span className="shrink-0">{icon}</span> : null}
				<span className="truncate">{value}</span>
			</div>
		</div>
	);
}

const CF_SEP = "|";

function paramsToSelectedConfig(params: URLSearchParams): Partial<FilterConfig> {
	const config: Partial<FilterConfig> = {};
	const assignList = (param: string, key: keyof FilterConfig) => {
		const value = params.get(param);
		if (value) (config as any)[key] = value.split(",").filter(Boolean);
	};
	assignList("models", "models");
	assignList("providers", "providers");
	assignList("traceTypes", "traceTypes");
	assignList("appNames", "applicationNames");
	assignList("spanNames", "spanNames");
	assignList("envs", "environments");
	assignList("services", "services");
	assignList("severities", "severities");
	assignList("metricNames", "metricNames");
	assignList("metricTypes", "metricTypes");
	const maxCost = params.get("maxCost");
	if (maxCost) config.maxCost = parseFloat(maxCost);
	const cfValues = params.getAll("cf");
	if (cfValues.length) {
		config.customFilters = cfValues
			.map((raw) => {
				const [attributeType, key, ...rest] = raw.split(CF_SEP);
				return {
					attributeType: (attributeType || "SpanAttributes") as any,
					key: key || "",
					value: rest.join(CF_SEP),
				};
			})
			.filter((filter) => filter.key && filter.value);
	}
	return config;
}

function filterFromSource(from: string | null, offsetOverride?: number): FilterType {
	const params = new URLSearchParams();
	if (from && typeof window !== "undefined") {
		const url = new URL(from, window.location.origin);
		url.searchParams.forEach((value, key) => params.append(key, value));
	}

	const range = (params.get("tr") || "24H") as TIME_RANGES;
	const customStart = params.get("ts");
	const customEnd = params.get("te");
	const timeLimit =
		range === "CUSTOM" && customStart && customEnd
			? { type: range, start: new Date(customStart), end: new Date(customEnd) }
			: {
					type: range,
					...(getTimeLimitObject(range, "") as { start: Date; end: Date }),
			  };

	return {
		timeLimit,
		limit: parseInt(params.get("limit") || "25", 10),
		offset: offsetOverride ?? parseInt(params.get("offset") || "0", 10),
		selectedConfig: paramsToSelectedConfig(params),
		sorting: { type: "Timestamp", direction: "desc" },
		refreshRate: "1m",
		filterReady: true,
		groupBy: params.get("gb") || undefined,
		groupValue: params.get("gbv") || undefined,
	};
}

function sourceWithOffset(from: string | null, offset: number) {
	if (!from || typeof window === "undefined") return from;
	const url = new URL(from, window.location.origin);
	url.searchParams.set("offset", String(offset));
	return `${url.pathname}${url.search}`;
}

export function TraceDetailView({
	spanId,
	type,
	variant = "page",
	onSpanChange,
	onActiveSpanChange,
	extraActions,
	navigationRows,
	navigationOffset,
	navigationTotal,
	navigationFilter,
	onNavigationPageChange,
}: {
	spanId: string;
	type: "traces" | "exceptions";
	variant?: "page" | "sheet";
	onSpanChange?: (spanId: string) => void;
	onActiveSpanChange?: (spanId: string) => void;
	extraActions?: ReactNode;
	navigationRows?: any[];
	navigationOffset?: number;
	navigationTotal?: number;
	navigationFilter?: FilterType;
	onNavigationPageChange?: (offset: number) => void;
}) {
	const m = getMessage();
	const router = useRouter();
	const searchParams = useSearchParams();
	const from = searchParams.get("from");
	const [selectedSpanId, setSelectedSpanId] = useState(spanId);
	const [activeListSpanId, setActiveListSpanId] = useState(spanId);
	// Per-session code-impact rollups (lines added / removed,
	// commits, edit accept/reject, PRs, acceptance %) fetched by
	// session_id from the trace's coding-agent attributes. Used to
	// keep the trace-detail header pills populated even when the
	// operator clicks into a child span (llm.turn / edit.decision /
	// tool.call) — those don't carry the rollup attrs directly.
	// Shape mirrors `CodingSessionDigest` from the queries module.
	const [sessionDigest, setSessionDigest] = useState<{
		lines_added: number;
		lines_removed: number;
		lines_accepted: number;
		lines_rejected: number;
		edit_accept_count: number;
		edit_reject_count: number;
		commit_count: number;
		pr_count: number;
		acceptance_pct: number;
		// Session-level usage rollups (see CodingSessionDigest in
		// `lib/platform/coding-agents/queries.ts`). These power the
		// top-card overrides below so a still-running coding-agent
		// session doesn't render Tokens / Cost / Duration / Model as
		// empty just because the user is looking at a child span.
		total_tokens: number;
		input_tokens: number;
		output_tokens: number;
		cost_usd: number;
		duration_ms: number;
		model: string;
		// Latest VCS / workspace context across the session (see
		// CodingSessionDigest). The header pills prefer these over the
		// selected span's own attributes so a mid-session branch / repo /
		// folder switch is reflected regardless of which (often the
		// chronologically-first) span the detail view opened on.
		repo_url: string;
		branch: string;
		working_dir: string;
		working_dir_label: string;
	} | null>(null);
	const hierarchySpanIdRef = useRef(spanId);
	const [listOffset, setListOffset] = useState(() => filterFromSource(from).offset);
	const [navigationPageOverride, setNavigationPageOverride] = useState<{
		rows: any[];
		offset: number;
		total?: number;
	} | null>(null);
	const fromRef = useRef(from);
	const listUrlRef = useRef(type === "exceptions" ? "/api/metrics/exception" : "/api/metrics/request");
	const detailBasePathRef = useRef(
		type === "exceptions" ? "/telemetry/exceptions" : "/telemetry/traces"
	);
	const { data, fireRequest, isLoading } = useFetchWrapper();
	const {
		data: listData,
		fireRequest: fireListRequest,
		isLoading: isListLoading,
	} = useFetchWrapper<any>();
	const fetchData = useCallback(() => {
		fireRequest({
			requestType: "GET",
			url: `/api/metrics/request/span/${selectedSpanId}`,
		});
	}, [fireRequest, selectedSpanId]);

	useEffect(() => {
		hierarchySpanIdRef.current = spanId;
		setSelectedSpanId(spanId);
		setActiveListSpanId(spanId);
		setNavigationPageOverride((currentPage) =>
			currentPage?.rows.some((row: any) => row.spanId === spanId)
				? currentPage
				: null
		);
	}, [spanId]);

	useEffect(() => {
		fetchData();
	}, [fetchData]);

	const navigateToListSpan = useCallback(
		(nextSpanId: string) => {
			hierarchySpanIdRef.current = nextSpanId;
			setActiveListSpanId(nextSpanId);
			setSelectedSpanId(nextSpanId);
			const source = fromRef.current;
			const qs = source ? `?from=${encodeURIComponent(source)}` : "";
			if (variant === "page") {
				router.replace(`${detailBasePathRef.current}/${nextSpanId}${qs}`, { scroll: false });
			}
			onSpanChange?.(nextSpanId);
		},
		[onSpanChange, router, variant]
	);

	const selectSpanInCurrentTrace = useCallback(
		(nextSpanId: string) => {
			// The synthetic session-root node has no backing row in
			// `otel_traces`. Selecting it would fire a span-detail fetch
			// and an AI-analysis fetch that both 404 ("Span not found"
			// toast) and blank the detail panel. It's a visual grouping
			// node only — ignore clicks so the panel stays on the last
			// real span the developer was viewing.
			if (isSyntheticSpanId(nextSpanId)) return;
			setSelectedSpanId(nextSpanId);
			onActiveSpanChange?.(nextSpanId);
		},
		[onActiveSpanChange]
	);

	const fetchList = useCallback(
		(offset: number, direction?: -1 | 1) => {
			const listFilter = fromRef.current
				? filterFromSource(fromRef.current, offset)
				: navigationFilter
					? { ...navigationFilter, offset }
					: filterFromSource(fromRef.current, offset);
			fireListRequest({
				body: JSON.stringify(listFilter),
				requestType: "POST",
				url: listUrlRef.current,
				successCb: (response) => {
					if (!direction) return;
					const records = ((response as any)?.records || []).map(normalizeTrace);
					const target =
						direction === 1 ? records[0] : records[records.length - 1];
					if (target?.spanId) {
						const nextSource = sourceWithOffset(fromRef.current, offset);
						fromRef.current = nextSource;
						setListOffset(offset);
						setNavigationPageOverride({
							rows: records,
							offset,
							total: (response as any)?.total,
						});
						onNavigationPageChange?.(offset);
						navigateToListSpan(target.spanId);
					}
				},
			});
		},
		[fireListRequest, navigateToListSpan, navigationFilter, onNavigationPageChange]
	);

	useEffect(() => {
		fetchList(listOffset);
		// Only hydrate the neighboring list once. Explicit page-boundary navigation
		// fetches another page on demand; making this reactive causes route updates
		// to cascade into repeated list fetches.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const raw = (data as any)?.record;
	const trace = raw ? normalizeTrace(raw) : null;
	const resourceAttributes = raw?.ResourceAttributes || {};
	const spanAttributes = raw?.SpanAttributes || {};
	const serviceNamespace = resourceAttributes["service.namespace"];
	const deploymentEnvironment =
		resourceAttributes["deployment.environment"] ||
		(trace as any)?.environment ||
		(trace as any)?.deploymentType;
	const statusValue =
		raw?.StatusMessage || raw?.StatusCode
			? [raw?.StatusCode, raw?.StatusMessage].filter(Boolean).join(" / ")
			: undefined;
	// Coding-agent extras: repo URL/branch, vendor, classification — surfaced
	// as MetaPills below the header so the session detail keeps the same
	// signal users had on the dedicated session sheet.
	//
	// All of these fields live ONLY on the session-root span when the
	// CLI emits them (working folder, repo, branch, mode, outcome,
	// classification). When a developer clicks on a child span — an
	// llm.turn or a tool.call — the SpanAttributes don't carry them.
	// We fall through to ResourceAttributes (which the CLI also stamps
	// per process so every span in the same process invocation has
	// them) so the header pills stay populated regardless of which
	// span the developer drills into.
	const ca = (k: string) =>
		(spanAttributes[k] as string) || (resourceAttributes[k] as string) || "";
	const codingAgentVendor = (ca("coding_agent.client") ||
		ca("gen_ai.agent.name") ||
		"") as string;
	// Prefer the session digest's LATEST repo / branch / folder (resolved
	// across every span by Timestamp) over the currently-selected span's
	// own attributes. The detail view opens on the session-root span,
	// which is the chronologically-FIRST span and therefore carries the
	// session-start VCS snapshot — so without this a mid-session branch
	// switch would keep showing the old branch. `sessionDigest` is only
	// populated for coding-agent sessions, so this is a no-op elsewhere.
	const repoUrl = sessionDigest?.repo_url || ca("vcs.repository.url.full");
	const repoLabel = repoUrl
		? repoUrl.replace(/^https?:\/\//, "").replace(/\.git$/, "")
		: "";
	const branchName = sessionDigest?.branch || ca("vcs.ref.head.name");
	const codingAgentUser = (spanAttributes["gen_ai.user.name"] ||
		resourceAttributes["gen_ai.user.name"] ||
		"") as string;
	const rawOutcome = ca("coding_agent.session.outcome");
	// "unknown" is what the CLI stamps when a session ends without a
	// definitive reason (e.g. the user closed the editor before
	// sessionEnd fired). It carries no information for the operator,
	// so render an empty pill rather than a confusing "unknown" chip.
	const sessionOutcome = rawOutcome && rawOutcome !== "unknown" ? rawOutcome : "";
	const rawClassification = ca("coding_agent.user.classification");
	const userClassification =
		rawClassification && rawClassification !== "unknown" ? rawClassification : "";
	// Working folder ("cwd") — the host process directory where the
	// agent was invoked. Useful when a developer has multiple repos
	// open at once and the repo URL alone doesn't disambiguate.
	const workingDir = sessionDigest?.working_dir || ca("code.cwd");
	const workingDirLabel =
		sessionDigest?.working_dir_label ||
		(workingDir
			? workingDir.split("/").filter(Boolean).slice(-2).join("/") || workingDir
			: "");
	// Permission mode (Cursor's composer_mode / Claude Code's permission mode).
	// We surface the LATEST recorded value so the chat view header
	// reflects what the agent is currently set to even if the user
	// flipped modes mid-session.
	const permissionMode = ca("coding_agent.policy.permission_mode");
	const terminalType = (resourceAttributes["terminal.type"] || "") as string;
	// Per-session code-impact rollups. The CLI stamps these on the
	// session-root span at SessionEnd, so they're only populated on
	// the root span itself; clicking a child span (llm.turn,
	// edit.decision, tool.call) would leave the pills empty. We
	// fold them up to every child span via a tiny digest endpoint
	// keyed by `coding_agent.session.id`, falling back to the
	// span-level attribute when the digest hasn't arrived yet (or
	// can't be fetched). The digest itself reuses the same
	// greatest(rollup-attr, per-edit-sum) dual-source pattern as
	// SESSION_BASE_COLUMNS, so the numbers are guaranteed to match
	// what the Sessions list and the per-session detail view show.
	const isCodingAgentTrace = !!codingAgentVendor;
	const codingSessionId = ca("coding_agent.session.id");

	// Fold per-session code-impact rollups up to whichever span the
	// operator is viewing. The session-root attributes (`session.lines.added`
	// etc.) only land on SessionEnd; child spans (turns, edits, tool
	// calls) don't carry them. The digest endpoint runs the same
	// dual-source greatest() logic the Sessions list does so the
	// totals can never disagree across surfaces. Best-effort: a
	// failed lookup just leaves the pills auto-hidden via the
	// empty-value guard below.
	useEffect(() => {
		if (!isCodingAgentTrace || !codingSessionId) {
			setSessionDigest(null);
			return;
		}
		let cancelled = false;
		(async () => {
			try {
				const res = await fetch(
					`/api/coding-agents/sessions/${encodeURIComponent(codingSessionId)}/digest`,
				);
				if (!res.ok) return;
				const body = (await res.json()) as { data?: typeof sessionDigest };
				if (!cancelled && body?.data) setSessionDigest(body.data);
			} catch {
				// Best-effort — pills fall back to the span-level
				// attributes (which are populated on the session-root span).
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [isCodingAgentTrace, codingSessionId]);

	const linesAdded = ca("coding_agent.session.lines.added");
	const linesRemoved = ca("coding_agent.session.lines.removed");
	const linesAddedNum =
		Number(linesAdded || 0) ||
		Number(sessionDigest?.lines_added || 0);
	const linesRemovedNum =
		Number(linesRemoved || 0) ||
		Number(sessionDigest?.lines_removed || 0);
	// Split add/remove counts into their own pills so the header is
	// scannable at a glance ("+128 added" / "-42 removed") rather
	// than a packed slash-separated combo. We keep each pill empty
	// when its underlying count is missing or zero so the row
	// doesn't render a noisy `+0` / `-0` for sessions that didn't
	// touch any code yet.
	const linesAddedValue = linesAddedNum > 0
		? `+${linesAddedNum.toLocaleString()}`
		: "";
	const linesRemovedValue = linesRemovedNum > 0
		? `-${linesRemovedNum.toLocaleString()}`
		: "";
	const editAccepts =
		Number(ca("coding_agent.session.edit.accept_count") || 0) ||
		Number(sessionDigest?.edit_accept_count || 0);
	const editRejects =
		Number(ca("coding_agent.session.edit.reject_count") || 0) ||
		Number(sessionDigest?.edit_reject_count || 0);
	const editTotal = editAccepts + editRejects;
	const acceptanceValue = editTotal > 0
		? `${Math.round((editAccepts * 100) / editTotal)}%`
		: "";
	const commitCountNum =
		Number(ca("coding_agent.session.commit_count") || 0) ||
		Number(sessionDigest?.commit_count || 0);
	const commitCountValue = commitCountNum > 0
		? commitCountNum.toLocaleString()
		: "";
	const prCountNum =
		Number(ca("coding_agent.session.pr_count") || 0) ||
		Number(sessionDigest?.pr_count || 0);
	const prCountValue = prCountNum > 0 ? prCountNum.toLocaleString() : "";

	// Content-capture banner gating.
	//
	// We show the "content capture is off" hint only when the span's
	// own `coding_agent.content_capture_mode` resource attribute (which
	// the CLI stamps from cfg.CodingContentCapture on every span) is
	// explicitly something other than "full". That's the authoritative
	// signal — much more reliable than the previous heuristic of
	// "no content-bearing attribute is populated", which produced
	// false positives on spans where the vendor legitimately emits
	// empty bodies (e.g. a Grep tool call whose tool_input was empty)
	// even though the CLI is in full mode.
	const captureModeRaw = ca("coding_agent.content_capture_mode");
	const captureMode =
		typeof captureModeRaw === "string" ? captureModeRaw.trim().toLowerCase() : "";
	const showContentCaptureNote =
		isCodingAgentTrace && captureMode !== "" && captureMode !== "full";

	const hasEvaluationPanel = trace
		? getExtraTabsContentTypes(trace).includes("Evaluation")
		: false;
	const analysisTab = selectedSpanId
		? {
				id: "ai-analysis",
				label: m.TRACE_AI_TAB_TITLE,
				content: (
					<RequestProvider syncUrl={false}>
						<TraceAiAnalysisPanel
							spanId={selectedSpanId}
							scope="span"
							description={m.TRACE_AI_IMPROVEMENT_SPAN_DESCRIPTION}
						/>
					</RequestProvider>
				),
		  }
		: null;
	const extraDetailTabs = [
		...(analysisTab ? [analysisTab] : []),
		...(hasEvaluationPanel && trace
			? [
					{
						id: "evaluations",
						label: "Evaluations",
						content: <Evaluations trace={trace} surface="observability" />,
					},
			  ]
			: []),
	];
	const detailTabs = useMemo(
		() => buildObjectTabs(raw, {
			labelOverrides: {
				SpanAttributes: "Span Attributes",
				ResourceAttributes: "Resource Attributes",
			},
		}),
		[raw]
	);
	const title = trace?.spanName || (isLoading ? m.OBSERVABILITY_TRACE_LOADING : selectedSpanId);
	const resultsHref =
		from || `/telemetry?tab=${type === "exceptions" ? "exceptions" : "traces"}`;
	const breadcrumbTitle = trace?.spanName || (isLoading ? m.OBSERVABILITY_LOADING : m.OBSERVABILITY_TRACE_DETAILS);

	const customHeader = useMemo(
		() => ({
			title: breadcrumbTitle,
			description: selectedSpanId,
			breadcrumbs: [
				{ title: m.OBSERVABILITY_TITLE, href: resultsHref },
			],
		}),
		[breadcrumbTitle, m.OBSERVABILITY_TITLE, resultsHref, selectedSpanId]
	);
	useCustomBreadcrumbs(customHeader, [selectedSpanId, resultsHref], variant === "page");
	const listRows = useMemo(
		() => (((listData as any)?.records || []).map(normalizeTrace)),
		[listData]
	);
	const effectiveListRows = navigationPageOverride?.rows?.length
		? navigationRows?.some((row: any) => row.spanId === activeListSpanId)
			? navigationRows
			: navigationPageOverride.rows
		: navigationRows?.length
			? navigationRows
			: listRows;
	const effectiveListOffset =
		navigationPageOverride?.rows?.length &&
		!navigationRows?.some((row: any) => row.spanId === activeListSpanId)
			? navigationPageOverride.offset
			: navigationOffset ?? listOffset;
	const total =
		navigationPageOverride?.rows?.length &&
		!navigationRows?.some((row: any) => row.spanId === activeListSpanId)
			? navigationPageOverride.total ?? navigationTotal ?? (listData as any)?.total ?? 0
			: navigationTotal ?? (listData as any)?.total ?? 0;
	const currentIndex = effectiveListRows.findIndex((row: any) => row.spanId === activeListSpanId);
	const navigationLimit =
		navigationFilter?.limit ?? filterFromSource(fromRef.current).limit;
	const canPrev = currentIndex > 0 || effectiveListOffset > 0;
	const canNext =
		currentIndex >= 0 &&
		(currentIndex < effectiveListRows.length - 1 || effectiveListOffset + effectiveListRows.length < total);

	const selectPrev = () => {
		if (currentIndex > 0) {
			navigateToListSpan(effectiveListRows[currentIndex - 1].spanId);
		} else if (effectiveListOffset > 0) {
			fetchList(Math.max(0, effectiveListOffset - navigationLimit), -1);
		}
	};

	const selectNext = () => {
		if (currentIndex >= 0 && currentIndex < effectiveListRows.length - 1) {
			navigateToListSpan(effectiveListRows[currentIndex + 1].spanId);
		} else if (effectiveListOffset + effectiveListRows.length < total) {
			fetchList(effectiveListOffset + navigationLimit, 1);
		}
	};

	const goBack = () => {
		router.push(resultsHref);
	};

	// Top-card overrides for coding-agent sessions only.
	//
	// `trace.*` is span-local — for a still-running session viewed at
	// its root, or for any child span (llm.turn / tool.call /
	// edit.decision) clicked into via the hierarchy explorer, those
	// fields are either zero or reflect only that one span's slice.
	// The sessions list page meanwhile shows the session-level
	// rollup; without these overrides the trace-detail header
	// silently disagrees with the row the user just clicked through
	// from.
	//
	// Hard scope guardrail: `isCodingAgentTrace` is derived from
	// `coding_agent.client` (set exclusively by the CLI's hook
	// adapters in `cli/internal/otlp/exporter.go`). Non-coding traces
	// (SDK instrumentation, manual OTel spans, ad-hoc curl) fall
	// through to the existing `trace.*` values unchanged — the
	// digest fetch itself is also gated on this flag (see useEffect
	// at ~line 500), so for non-coding traces `sessionDigest` stays
	// null and every override here short-circuits.
	const codingTokensValue =
		isCodingAgentTrace && sessionDigest && Number(sessionDigest.total_tokens) > 0
			? Number(sessionDigest.total_tokens).toLocaleString()
			: undefined;
	const codingCostValue =
		isCodingAgentTrace && sessionDigest && Number(sessionDigest.cost_usd) > 0
			? `$${Number(sessionDigest.cost_usd).toFixed(4)}`
			: undefined;
	const codingDurationValue =
		isCodingAgentTrace && sessionDigest
			? formatSessionDurationMs(Number(sessionDigest.duration_ms || 0))
			: "";
	const codingModelValue =
		isCodingAgentTrace && sessionDigest && sessionDigest.model
			? sessionDigest.model
			: "";

	const tokensValue = codingTokensValue ?? trace?.totalTokens;
	const costValue =
		codingCostValue ?? (trace?.cost && trace.cost !== "-" ? `$${trace.cost}` : undefined);
	const durationValue =
		codingDurationValue ||
		(trace ? `${parseFloat(trace.requestDuration).toFixed(3)}s` : "");
	const modelValue = codingModelValue || trace?.model || trace?.serviceName;

	return (
		<DetailShell
			title={title}
			compact
			leadingActions={
				variant === "page" ? (
					<Button
						variant="outline"
						size="sm"
						onClick={goBack}
						className="h-8 w-8 p-0"
						title={m.OBSERVABILITY_BACK}
					>
						<ArrowLeft className="h-3.5 w-3.5" />
					</Button>
				) : undefined
			}
			headerMeta={
				trace ? (
					<div className="grid grid-cols-2 gap-1.5 md:grid-cols-3 xl:grid-cols-5">
						{statusValue && (
							<Stat icon={<AlertTriangle className="h-3.5 w-3.5" />} label="Status" value={statusValue} />
						)}
						<Stat icon={<Clock className="h-3.5 w-3.5" />} label={m.OBSERVABILITY_DURATION} value={durationValue} />
						<Stat icon={<Zap className="h-3.5 w-3.5" />} label={m.OBSERVABILITY_TOKENS} value={tokensValue} />
						<CostStat
							costValue={costValue}
							spanId={trace.spanId}
							hasModel={!!modelValue}
							onRecalculated={fetchData}
						/>
						<Stat icon={<Cpu className="h-3.5 w-3.5" />} label={m.OBSERVABILITY_MODEL} value={modelValue} />
					</div>
				) : undefined
			}
			actions={
				<div className="flex flex-wrap items-center justify-end gap-2">
					<div className="flex items-center gap-1 rounded-md border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 p-0.5">
						<button
							onClick={selectPrev}
							disabled={!canPrev || isListLoading}
							className="rounded p-1 text-stone-500 hover:bg-stone-100 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-30 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
							title={m.OBSERVABILITY_PREVIOUS_SPAN}
						>
							<ChevronLeft className="h-4 w-4" />
						</button>
						<span className="min-w-[4.5rem] px-1 text-center text-xs tabular-nums text-stone-500 dark:text-stone-400">
							{currentIndex >= 0 ? `${effectiveListOffset + currentIndex + 1} / ${total || effectiveListRows.length}` : "-"}
						</span>
						<button
							onClick={selectNext}
							disabled={!canNext || isListLoading}
							className="rounded p-1 text-stone-500 hover:bg-stone-100 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-30 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
							title={m.OBSERVABILITY_NEXT_SPAN}
						>
							<ChevronRight className="h-4 w-4" />
						</button>
					</div>
					{extraActions}
				</div>
			}
		>
			{trace && (
				<>
					<div className="flex flex-wrap gap-1.5">
						<MetaPill label={m.OBSERVABILITY_TRACE_ID} value={trace.id} />
						<MetaPill label={m.OBSERVABILITY_SPAN_ID} value={trace.spanId} />
						{!isCodingAgentTrace && (
							<>
								<MetaPill label={m.OBSERVABILITY_SERVICE} value={trace.serviceName} />
								<MetaPill label="Service Namespace" value={serviceNamespace} />
								<MetaPill label="Deployment Environment" value={deploymentEnvironment} />
							</>
						)}
						{isCodingAgentTrace && (
							<>
								<MetaPill
									label="Coding Agent"
									value={codingAgentVendor}
									icon={
										hasCodingAgentVendorIcon(codingAgentVendor) ? (
											<CodingAgentVendorIcon
												vendor={codingAgentVendor}
												className="h-3.5 w-3.5"
											/>
										) : null
									}
								/>
								{/* User pill only renders for coding-agent
								    traces; on non-coding spans `gen_ai.user.name`
								    is usually empty and the pill became
								    blank noise. */}
								{codingAgentUser ? (
									<MetaPill label="User" value={codingAgentUser} />
								) : null}
							</>
						)}
						<MetaPill label="Working Folder" value={workingDirLabel} />
						<MetaPill label="Repository" value={repoLabel} />
						<MetaPill label="Branch" value={branchName} />
						{!isCodingAgentTrace && (
							<MetaPill label="Mode" value={permissionMode} />
						)}
						<MetaPill label="Terminal" value={terminalType} />
						{isCodingAgentTrace && (
							<>
								{/* Code-impact pills, anchored next to
								    Terminal so the row reads as one
								    "what was done in this session"
								    cluster. Order: Commits first
								    (whether work shipped), then the
								    add/remove split (volume), then
								    Acceptance + PRs as supporting
								    quality / shipping signals. */}
								<MetaPill label="Commits" value={commitCountValue} />
								<MetaPill label="Lines added" value={linesAddedValue} />
								<MetaPill label="Lines deleted" value={linesRemovedValue} />
								<MetaPill label="Acceptance" value={acceptanceValue} />
								<MetaPill label="PRs" value={prCountValue} />
							</>
						)}
						<MetaPill label="Outcome" value={sessionOutcome} />
						<MetaPill label="Classification" value={userClassification} />
					</div>
					{showContentCaptureNote && (
						<ContentCaptureNote />
					)}
					<div className="hidden h-[min(860px,calc(100vh-12rem))] min-h-[620px] overflow-hidden rounded-md border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950 lg:block">
						<ResizablePanelGroup direction="horizontal" className="h-full">
							<ResizablePanel defaultSize={48} minSize={32} maxSize={68}>
								<div className="h-full min-h-0 p-2">
									<SpanHierarchyExplorer
										hierarchySpanId={hierarchySpanIdRef.current}
										selectedSpanId={selectedSpanId}
										onSelectSpan={selectSpanInCurrentTrace}
										fill
									/>
								</div>
							</ResizablePanel>
							<ResizableHandle withHandle />
							<ResizablePanel defaultSize={52} minSize={32}>
								<div className="h-full min-h-0 overflow-auto p-2">
									<DetailObjectTabs
										tabs={detailTabs}
										extraTabs={extraDetailTabs}
										extraTabsPlacement="before"
									/>
								</div>
							</ResizablePanel>
						</ResizablePanelGroup>
					</div>
					<div className="grid gap-3 lg:hidden">
						<SpanHierarchyExplorer
							hierarchySpanId={hierarchySpanIdRef.current}
							selectedSpanId={selectedSpanId}
							onSelectSpan={selectSpanInCurrentTrace}
						/>
						<DetailObjectTabs
							tabs={detailTabs}
							extraTabs={extraDetailTabs}
							extraTabsPlacement="before"
						/>
					</div>
				</>
			)}
		</DetailShell>
	);
}

export default function TraceDetailPage({
	spanId,
	type,
}: {
	spanId: string;
	type: "traces" | "exceptions";
}) {
	return <TraceDetailView spanId={spanId} type={type} variant="page" />;
}
