"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, ChevronDown, Clock, FileWarning, GitBranch, ShieldAlert } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@/components/ui/select";
import {
	Pagination,
	PaginationContent,
	PaginationItem,
	PaginationNext,
	PaginationPrevious,
} from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import getMessage from "@/constants/messages";
import { formatBrowserDateTime } from "@/utils/date";
import { getRequestHeaders } from "@/utils/api";
import type { ScannerFinding, ScannerJob } from "@/lib/platform/connectors/scanner/types";
import {
	SCANNER_FINDINGS_PAGE_SIZE,
	type ScannerFindingCounts,
	type ScannerFindingPageItem,
	type ScannerFindingSeverityFilter,
} from "@/lib/platform/connectors/scanner/job-findings";

function formatDuration(durationMs?: number): string {
	if (!durationMs || durationMs <= 0) return "—";
	if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
	const sec = durationMs / 1000;
	if (sec < 60) return `${sec < 10 ? sec.toFixed(1) : Math.round(sec)}s`;
	return `${(sec / 60).toFixed(1)}m`;
}

function formatScore(score: number | undefined, asValue: (n: number) => string): string | undefined {
	if (typeof score !== "number" || !Number.isFinite(score)) return undefined;
	const outOf100 = Math.round(score <= 1 ? score * 100 : score);
	if (outOf100 < 0) return undefined;
	return asValue(Math.min(outOf100, 100));
}

function findingCount(job?: ScannerJob | null): number {
	return job?.findingCount ?? job?.findings?.length ?? 0;
}

function mediumPlusCount(job?: ScannerJob | null): number {
	if (typeof job?.mediumPlusCount === "number") return job.mediumPlusCount;
	return (job?.findings || []).filter((item) =>
		["medium", "high", "critical", "error"].includes(item.severity)
	).length;
}

function Stat({ icon, label, value, hint }: { icon: ReactNode; label: string; value?: string; hint?: string }) {
	return (
		<div className="rounded-md bg-stone-100 px-2 py-1 dark:bg-stone-900">
			<div className="flex items-center gap-1 text-[10px] text-stone-500 dark:text-stone-400">
				{icon}
				{label}
			</div>
			<div className="mt-0.5 truncate text-xs font-semibold text-stone-900 dark:text-stone-100">
				{value || "—"}
			</div>
			{hint ? <div className="truncate text-[10px] text-muted-foreground">{hint}</div> : null}
		</div>
	);
}

function MetaPill({ label, value }: { label: string; value?: string }) {
	if (!value) return null;
	return (
		<div className="min-w-0 rounded-md border border-stone-200 bg-white px-2 py-1 dark:border-stone-800 dark:bg-stone-950">
			<div className="text-[10px] uppercase tracking-wide text-stone-500 dark:text-stone-400">{label}</div>
			<div className="max-w-72 truncate font-mono text-[11px] font-medium text-stone-900 dark:text-stone-100" title={value}>
				{value}
			</div>
		</div>
	);
}

function severityTone(severity: string): string {
	if (severity === "critical") {
		return "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300";
	}
	if (severity === "high") {
		return "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300";
	}
	if (severity === "medium") {
		return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300";
	}
	if (severity === "info" || severity === "meta") {
		return "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300";
	}
	return "bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300";
}

function severityBar(severity: string): string {
	if (severity === "critical") return "bg-rose-600";
	if (severity === "high") return "bg-orange-500";
	if (severity === "medium") return "bg-amber-400";
	return "bg-stone-300 dark:bg-stone-600";
}

function inventoryLabel(messages: ReturnType<typeof getMessage>, job?: ScannerJob | null): string | undefined {
	const report = job?.report;
	if (!report) return undefined;
	const parts = [
		report.toolCount ? `${report.toolCount} ${messages.SCANNER_TOOLS.toLowerCase()}` : "",
		report.agentCount ? `${report.agentCount} ${messages.SCANNER_AGENTS.toLowerCase()}` : "",
		report.mcpCount ? `${report.mcpCount} ${messages.SCANNER_MCP.toLowerCase()}` : "",
		report.skillCount ? `${report.skillCount} ${messages.SCANNER_SKILLS.toLowerCase()}` : "",
		report.subagentCount ? `${report.subagentCount} ${messages.SCANNER_SUBAGENTS.toLowerCase()}` : "",
	].filter(Boolean);
	return parts.length ? parts.join(" · ") : undefined;
}

function coverageLabel(job?: ScannerJob | null): string | undefined {
	const parsed = job?.report?.filesParsed;
	const skipped = job?.report?.filesSkipped;
	if (parsed == null && skipped == null) return undefined;
	return `${parsed ?? 0} / ${skipped ?? 0}`;
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
	const [debounced, setDebounced] = useState(value);
	useEffect(() => {
		const timer = window.setTimeout(() => setDebounced(value), delayMs);
		return () => window.clearTimeout(timer);
	}, [delayMs, value]);
	return debounced;
}

const EMPTY_COUNTS: ScannerFindingCounts = { all: 0, critical: 0, high: 0, medium: 0, low: 0 };

export default function ScannerWorkspace({
	connectorId,
	repoLabel,
	jobs,
	selectedJob,
	previousJob,
	onSelectJob,
	onOpenFinding,
}: {
	connectorId?: string;
	repoLabel?: string;
	jobs: ScannerJob[];
	selectedJob?: ScannerJob;
	previousJob?: ScannerJob;
	onSelectJob: (jobId: string) => void;
	onOpenFinding: (finding: ScannerFinding, alertNumber: number) => void;
}) {
	const messages = getMessage();
	const [severityFilter, setSeverityFilter] = useState<ScannerFindingSeverityFilter>("all");
	const [query, setQuery] = useState("");
	const [page, setPage] = useState(1);
	const [loading, setLoading] = useState(false);
	const [findings, setFindings] = useState<ScannerFindingPageItem[]>([]);
	const [total, setTotal] = useState(0);
	const [counts, setCounts] = useState<ScannerFindingCounts>(EMPTY_COUNTS);
	const debouncedQuery = useDebouncedValue(query, 300);
	const openDelta = previousJob ? findingCount(selectedJob) - findingCount(previousJob) : null;
	const mediumDelta = previousJob ? mediumPlusCount(selectedJob) - mediumPlusCount(previousJob) : null;
	const params = selectedJob?.params;
	const extras = selectedJob?.report?.extras;
	const extraFlags = Object.entries(params?.extras || {})
		.filter(([, value]) => value === true || (typeof value === "string" && value))
		.map(([key, value]) => (value === true ? key : `${key}=${value}`));
	const enabledFlags = [
		params?.strict ? messages.SCANNER_FIELD_STRICT : "",
		params?.secretScan ? messages.SCANNER_FIELD_SECRET_SCAN : "",
		params?.vulnScan ? messages.SCANNER_FIELD_VULN_SCAN : "",
		params?.licenseScan ? messages.SCANNER_FIELD_LICENSE_SCAN : "",
		params?.noRulesUpdate ? messages.SCANNER_FIELD_NO_RULES_UPDATE : "",
		params?.verbose ? messages.SCANNER_FIELD_VERBOSE : "",
		...extraFlags,
	].filter(Boolean);
	const totalPages = Math.max(1, Math.ceil(total / SCANNER_FINDINGS_PAGE_SIZE) || 1);

	useEffect(() => {
		setQuery("");
		setSeverityFilter("all");
		setPage(1);
	}, [selectedJob?.id]);

	useEffect(() => {
		if (!connectorId || !selectedJob?.id) {
			setFindings([]);
			setTotal(0);
			setCounts(EMPTY_COUNTS);
			return;
		}
		const controller = new AbortController();
		setLoading(true);
		const params = new URLSearchParams({
			q: debouncedQuery,
			severity: severityFilter,
			page: String(page),
			limit: String(SCANNER_FINDINGS_PAGE_SIZE),
		});
		void fetch(
			`/api/scanners/${encodeURIComponent(connectorId)}/jobs/${encodeURIComponent(selectedJob.id)}/findings?${params}`,
			{ headers: getRequestHeaders(), signal: controller.signal }
		)
			.then(async (response) => {
				const body = await response.json();
				if (!response.ok) throw new Error(body?.err || messages.SCANNER_FINDINGS_LOAD_FAILED);
				if (controller.signal.aborted) return;
				setFindings(body.findings || []);
				setTotal(typeof body.total === "number" ? body.total : 0);
				setCounts(body.counts || EMPTY_COUNTS);
			})
			.catch((error: unknown) => {
				if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
					return;
				}
				setFindings([]);
				setTotal(0);
			})
			.finally(() => {
				if (!controller.signal.aborted) setLoading(false);
			});
		return () => controller.abort();
	}, [connectorId, debouncedQuery, messages.SCANNER_FINDINGS_LOAD_FAILED, page, selectedJob?.id, severityFilter]);

	const filters: { id: ScannerFindingSeverityFilter; label: string }[] = [
		{ id: "all", label: messages.SCANNER_OPEN_COUNT(counts.all) },
		{ id: "critical", label: `${messages.SCANNER_CRITICAL} ${counts.critical}` },
		{ id: "high", label: `${messages.SCANNER_HIGH} ${counts.high}` },
		{ id: "medium", label: `${messages.SCANNER_MEDIUM} ${counts.medium}` },
		{ id: "low", label: `${messages.SCANNER_LOW} ${counts.low}` },
	];

	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3">
			<div className="mb-2 space-y-2">
				<div className="flex items-start justify-between gap-3">
					<div className="min-w-0">
						<h2 className="truncate text-sm font-semibold text-stone-950 dark:text-stone-50">
							{repoLabel || selectedJob?.target || messages.FEATURE_SCANNER}
						</h2>
						<p className="mt-0.5 truncate text-[11px] text-muted-foreground">
							{messages.SCANNER_JOB_RUN_OPTION([
								messages.SCANNER_OPEN_COUNT(findingCount(selectedJob)),
								selectedJob?.status || "",
							])}
						</p>
					</div>
					{jobs.length && selectedJob ? (
						<Select value={selectedJob.id} onValueChange={onSelectJob}>
							<SelectTrigger
								aria-label={messages.SCANNER_JOB_RUN_LABEL}
								className="h-9 w-[13.5rem] shrink-0 gap-2 bg-white px-2 text-left text-xs dark:bg-stone-950 [&>span]:line-clamp-none [&>span]:flex [&>span]:min-w-0 [&>span]:flex-1 [&>svg]:ml-0 [&>svg]:size-3.5 [&>svg]:shrink-0"
							>
								<span className="flex min-w-0 flex-1 items-center gap-2">
									<Clock className="size-3.5 shrink-0 text-stone-500" />
									<span className="min-w-0 flex-1 text-left leading-tight">
										<span className="block text-[10px] font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">
											{messages.SCANNER_JOB_RUN_LABEL}
										</span>
										<span className="block truncate font-medium text-stone-900 dark:text-stone-100">
											{formatBrowserDateTime(selectedJob.startedAt)}
										</span>
									</span>
								</span>
							</SelectTrigger>
							<SelectContent align="end" className="w-72">
								{jobs.map((job) => (
									<SelectItem key={job.id} value={job.id} textValue={formatBrowserDateTime(job.startedAt)}>
										<span className="flex min-w-0 flex-col">
											<span className="truncate">{formatBrowserDateTime(job.startedAt)}</span>
											<span className="truncate text-[10px] text-muted-foreground">
												{messages.SCANNER_JOB_RUN_OPTION([
													job.status,
													messages.SCANNER_FINDING_COUNT(job.findingCount ?? job.findings?.length ?? 0),
													job.ref,
													job.cliVersion,
												])}
											</span>
										</span>
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					) : (
						<span className="shrink-0 pt-2 text-[11px] text-muted-foreground">
							{messages.SCANNER_JOB_RUN_PLACEHOLDER}
						</span>
					)}
				</div>
				<div className="grid grid-cols-3 gap-1.5 lg:grid-cols-6">
					<Stat
						icon={<FileWarning className="h-3 w-3" />}
						label={messages.SCANNER_OPEN_FINDINGS}
						value={String(findingCount(selectedJob))}
						hint={openDelta !== null ? messages.SCANNER_VS_PREVIOUS(openDelta) : undefined}
					/>
					<Stat
						icon={<AlertTriangle className="h-3 w-3" />}
						label={messages.SCANNER_MEDIUM_PLUS}
						value={String(mediumPlusCount(selectedJob))}
						hint={mediumDelta !== null ? messages.SCANNER_VS_PREVIOUS(mediumDelta) : undefined}
					/>
					<Stat
						icon={<ShieldAlert className="h-3 w-3" />}
						label={messages.SCANNER_CRITICAL}
						value={String(counts.critical)}
					/>
					<Stat
						icon={<ShieldAlert className="h-3 w-3" />}
						label={messages.SCANNER_HIGH}
						value={String(counts.high)}
					/>
					<Stat
						icon={<GitBranch className="h-3 w-3" />}
						label={messages.SCANNER_SCORE}
						value={formatScore(selectedJob?.report?.overallScore, messages.SCANNER_SCORE_VALUE)}
					/>
					<Stat
						icon={<Clock className="h-3 w-3" />}
						label={messages.SCANNER_DURATION}
						value={formatDuration(selectedJob?.durationMs)}
					/>
				</div>
				<Collapsible className="overflow-hidden rounded-md border border-stone-200 dark:border-stone-800">
					<CollapsibleTrigger className="flex w-full items-center justify-between gap-2 bg-stone-50 px-2.5 py-1.5 text-left text-[11px] font-medium text-stone-700 hover:bg-stone-100 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800 [&[data-state=open]>svg]:rotate-180">
						{messages.SCANNER_JOB_DETAILS}
						<ChevronDown className="size-3.5 shrink-0 text-stone-500 transition-transform duration-200" />
					</CollapsibleTrigger>
					<CollapsibleContent>
						<div className="flex flex-wrap gap-1.5 border-t border-stone-200 bg-white p-2.5 dark:border-stone-800 dark:bg-stone-950">
							<MetaPill label={messages.SCANNER_STATUS} value={selectedJob?.status} />
							<MetaPill
								label={messages.SCANNER_EXIT_CODE}
								value={selectedJob?.exitCode != null ? String(selectedJob.exitCode) : undefined}
							/>
							<MetaPill label={messages.SCANNER_JOB_ID} value={selectedJob?.id} />
							<MetaPill label={messages.SCANNER_CLI_VERSION} value={selectedJob?.cliVersion} />
							<MetaPill label={messages.SCANNER_FIELD_REF} value={selectedJob?.ref} />
							<MetaPill label={messages.SCANNER_RULES_SOURCE} value={params?.rulesSource || selectedJob?.report?.rulesSource} />
							<MetaPill label={messages.SCANNER_RULES_VERSION} value={selectedJob?.report?.rulesVersion} />
							<MetaPill label={messages.SCANNER_FIELD_DETECTORS} value={params?.detectors} />
							<MetaPill label={messages.SCANNER_LANGUAGES} value={selectedJob?.report?.languages?.join(", ")} />
							<MetaPill label={messages.SCANNER_SDKS} value={selectedJob?.report?.sdks?.join(", ")} />
							<MetaPill label={messages.SCANNER_INVENTORY} value={inventoryLabel(messages, selectedJob)} />
							<MetaPill label={messages.SCANNER_COVERAGE} value={coverageLabel(selectedJob)} />
							<MetaPill label={messages.SCANNER_RUN_PARAMS_SCAN_SECTION} value={enabledFlags.join(" · ") || undefined} />
							{extras
								? Object.entries(extras).map(([key, value]) => (
										<MetaPill key={key} label={key} value={value} />
									))
								: null}
						</div>
					</CollapsibleContent>
				</Collapsible>
				{selectedJob?.report?.noAgentSurfaces ? (
					<p className="text-[11px] text-muted-foreground">{messages.SCANNER_NO_AGENT_SURFACES}</p>
				) : null}
				{selectedJob?.error ? (
					<p className="text-[11px] text-error">
						{messages.SCANNER_JOB_ERROR}: {selectedJob.error}
					</p>
				) : null}
			</div>

			<div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950">
				<div className="flex shrink-0 items-center gap-2 border-b border-stone-200 px-2 py-1.5 dark:border-stone-800">
					<div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
						{filters.map((filter) => {
							const active = severityFilter === filter.id;
							return (
								<button
									key={filter.id}
									type="button"
									onClick={() => {
										setSeverityFilter(filter.id);
										setPage(1);
									}}
									className={`h-7 shrink-0 rounded-md px-2 text-[11px] font-medium ${
										active
											? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900"
											: "text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-900"
									}`}
								>
									{filter.label}
								</button>
							);
						})}
					</div>
					<Input
						value={query}
						onChange={(event) => {
							setQuery(event.target.value);
							setPage(1);
						}}
						placeholder={messages.SCANNER_SEARCH_FINDINGS}
						className="h-7 w-40 shrink-0 text-xs"
						aria-label={messages.SCANNER_SEARCH_FINDINGS}
					/>
				</div>
				{selectedJob ? (
					loading && !findings.length ? (
						<div className="space-y-2 p-3">
							<Skeleton className="h-10 w-full" />
							<Skeleton className="h-10 w-full" />
							<Skeleton className="h-10 w-full" />
						</div>
					) : findings.length ? (
						<>
							<div className="min-h-0 flex-1 overflow-auto">
								{findings.map((item) => {
									const location = [item.path, item.line ? String(item.line) : ""]
										.filter(Boolean)
										.join(":");
									const meta = [item.ruleId, item.scope || item.category].filter(Boolean).join(" · ");
									return (
										<button
											key={item.id}
											type="button"
											onClick={() => onOpenFinding(item, item.alertNumber)}
											className="flex w-full items-stretch gap-0 border-b border-stone-100 text-left hover:bg-stone-50 dark:border-stone-900 dark:hover:bg-stone-900/60"
										>
											<span className={`w-1 shrink-0 ${severityBar(item.severity)}`} />
											<span className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2">
												<span className="w-8 shrink-0 font-mono text-[11px] text-stone-400">
													{messages.SCANNER_FINDING_NUMBER(item.alertNumber)}
												</span>
												<span className="min-w-0 flex-1">
													<span className="block truncate text-xs font-semibold text-stone-900 dark:text-stone-100">
														{item.title}
													</span>
													<span className="mt-0.5 block truncate text-[11px] text-stone-500 dark:text-stone-400">
														{meta}
													</span>
												</span>
												<span className="flex shrink-0 flex-col items-end gap-0.5">
													<span
														className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${severityTone(item.severity)}`}
													>
														{item.severity}
													</span>
													{location ? (
														<span className="max-w-36 truncate font-mono text-[10px] text-stone-500 dark:text-stone-400" title={location}>
															{location}
														</span>
													) : null}
												</span>
											</span>
										</button>
									);
								})}
							</div>
							{total > SCANNER_FINDINGS_PAGE_SIZE ? (
								<div className="flex shrink-0 items-center justify-end border-t border-stone-200 px-2 py-1 dark:border-stone-800">
									<Pagination className="m-0 w-auto">
										<PaginationContent className="gap-0.5">
											<PaginationItem>
												<PaginationPrevious
													className={`h-7 px-2 py-1 ${
														page === 1
															? "pointer-events-none cursor-not-allowed text-stone-400"
															: "text-stone-950 dark:text-stone-100"
													}`}
													aria-label={messages.SCANNER_PAGE_PREVIOUS}
													aria-disabled={page === 1}
													onClick={(event) => {
														event.preventDefault();
														setPage((value) => Math.max(1, value - 1));
													}}
												/>
											</PaginationItem>
											<PaginationItem>
												<div className="whitespace-nowrap px-1 text-xs text-stone-950 dark:text-stone-100">
													{messages.SCANNER_PAGE_OF(page, totalPages)}
												</div>
											</PaginationItem>
											<PaginationItem>
												<PaginationNext
													className={`h-7 px-2 py-1 ${
														page >= totalPages
															? "pointer-events-none cursor-not-allowed text-stone-400"
															: "text-stone-950 dark:text-stone-100"
													}`}
													aria-label={messages.SCANNER_PAGE_NEXT}
													aria-disabled={page >= totalPages}
													onClick={(event) => {
														event.preventDefault();
														setPage((value) => Math.min(totalPages, value + 1));
													}}
												/>
											</PaginationItem>
										</PaginationContent>
									</Pagination>
								</div>
							) : null}
						</>
					) : (
						<div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-muted-foreground">
							{messages.SCANNER_EMPTY_FINDINGS}
						</div>
					)
				) : (
					<div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-muted-foreground">
						{messages.SCANNER_EMPTY_REPO_JOBS}
					</div>
				)}
			</div>
		</div>
	);
}
