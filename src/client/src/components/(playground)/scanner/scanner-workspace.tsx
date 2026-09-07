"use client";

import type { ReactNode } from "react";
import { AlertTriangle, Clock, FileWarning, GitBranch, ShieldAlert } from "lucide-react";
import DetailShell from "@/components/(playground)/observability/detail-shell";
import { Badge } from "@/components/ui/badge";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@/components/ui/resizable";
import getMessage from "@/constants/messages";
import { formatBrowserDateTime } from "@/utils/date";
import type { ScannerFinding, ScannerJob } from "@/lib/platform/connectors/scanner/types";

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

function severityCounts(findings: ScannerFinding[]) {
	const counts = { critical: 0, high: 0, medium: 0, low: 0 };
	for (const finding of findings) {
		if (finding.severity === "critical") counts.critical += 1;
		else if (finding.severity === "high") counts.high += 1;
		else if (finding.severity === "medium") counts.medium += 1;
		else counts.low += 1;
	}
	return counts;
}

function Stat({ icon, label, value, hint }: { icon: ReactNode; label: string; value?: string; hint?: string }) {
	return (
		<div className="rounded-md bg-stone-100 px-2.5 py-1.5 dark:bg-stone-900">
			<div className="flex items-center gap-1.5 text-[11px] text-stone-500 dark:text-stone-400">
				{icon}
				{label}
			</div>
			<div className="mt-0.5 truncate text-xs font-semibold text-stone-900 dark:text-stone-100">
				{value || "—"}
			</div>
			{hint ? <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{hint}</div> : null}
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

export default function ScannerWorkspace({
	jobs,
	selectedJob,
	previousJob,
	onSelectJob,
	onOpenFinding,
}: {
	jobs: ScannerJob[];
	selectedJob?: ScannerJob;
	previousJob?: ScannerJob;
	onSelectJob: (jobId: string) => void;
	onOpenFinding: (finding: ScannerFinding) => void;
}) {
	const messages = getMessage();
	const findings = selectedJob?.findings || [];
	const severities = severityCounts(findings);
	const openDelta = previousJob ? findingCount(selectedJob) - findingCount(previousJob) : null;
	const mediumDelta = previousJob ? mediumPlusCount(selectedJob) - mediumPlusCount(previousJob) : null;
	const params = selectedJob?.params;
	const enabledFlags = [
		params?.strict ? messages.SCANNER_FIELD_STRICT : "",
		params?.secretScan ? messages.SCANNER_FIELD_SECRET_SCAN : "",
		params?.vulnScan ? messages.SCANNER_FIELD_VULN_SCAN : "",
		params?.licenseScan ? messages.SCANNER_FIELD_LICENSE_SCAN : "",
		params?.noRulesUpdate ? messages.SCANNER_FIELD_NO_RULES_UPDATE : "",
		params?.verbose ? messages.SCANNER_FIELD_VERBOSE : "",
	].filter(Boolean);

	return (
		<div className="min-h-0 flex-1 overflow-hidden p-3">
			<DetailShell
				compact
				fill
				title={selectedJob?.target || messages.FEATURE_SCANNER}
				headerMeta={
					<div className="space-y-2">
						<div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
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
								value={String(severities.critical)}
							/>
							<Stat
								icon={<ShieldAlert className="h-3 w-3" />}
								label={messages.SCANNER_HIGH}
								value={String(severities.high)}
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
						<div className="flex flex-wrap gap-1.5">
							<MetaPill label={messages.SCANNER_STATUS} value={selectedJob?.status} />
							<MetaPill
								label={messages.SCANNER_EXIT_CODE}
								value={selectedJob?.exitCode != null ? String(selectedJob.exitCode) : undefined}
							/>
							<MetaPill label={messages.SCANNER_JOB_ID} value={selectedJob?.id} />
							<MetaPill label={messages.SCANNER_FIELD_REF} value={selectedJob?.ref} />
							<MetaPill label={messages.SCANNER_RULES_SOURCE} value={params?.rulesSource || selectedJob?.report?.rulesSource} />
							<MetaPill label={messages.SCANNER_RULES_VERSION} value={selectedJob?.report?.rulesVersion} />
							<MetaPill label={messages.SCANNER_FIELD_DETECTORS} value={params?.detectors} />
							<MetaPill label={messages.SCANNER_LANGUAGES} value={selectedJob?.report?.languages?.join(", ")} />
							<MetaPill label={messages.SCANNER_SDKS} value={selectedJob?.report?.sdks?.join(", ")} />
							<MetaPill label={messages.SCANNER_INVENTORY} value={inventoryLabel(messages, selectedJob)} />
							<MetaPill label={messages.SCANNER_COVERAGE} value={coverageLabel(selectedJob)} />
							<MetaPill label={messages.SCANNER_RUN_PARAMS_SCAN_SECTION} value={enabledFlags.join(" · ") || undefined} />
						</div>
						{selectedJob?.report?.noAgentSurfaces ? (
							<p className="text-[11px] text-muted-foreground">{messages.SCANNER_NO_AGENT_SURFACES}</p>
						) : null}
						{selectedJob?.error ? (
							<p className="text-[11px] text-error">
								{messages.SCANNER_JOB_ERROR}: {selectedJob.error}
							</p>
						) : null}
					</div>
				}
			>
				<div className="min-h-0 flex-1 overflow-hidden rounded-md border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950">
					<ResizablePanelGroup direction="horizontal" className="h-full" autoSaveId="scanner-workspace-split">
						<ResizablePanel defaultSize={32} minSize={22} maxSize={48}>
							<JobsPane
								jobs={jobs}
								selectedJobId={selectedJob?.id}
								onSelectJob={onSelectJob}
							/>
						</ResizablePanel>
						<ResizableHandle withHandle aria-label={messages.SCANNER_SPLIT_RESIZE} />
						<ResizablePanel defaultSize={68} minSize={40}>
							<FindingsPane findings={findings} onOpenFinding={onOpenFinding} />
						</ResizablePanel>
					</ResizablePanelGroup>
				</div>
			</DetailShell>
		</div>
	);
}

function JobsPane({
	jobs,
	selectedJobId,
	onSelectJob,
}: {
	jobs: ScannerJob[];
	selectedJobId?: string;
	onSelectJob: (jobId: string) => void;
}) {
	const messages = getMessage();
	return (
		<div className="flex h-full min-h-0 flex-col overflow-hidden">
			<div className="flex shrink-0 items-center justify-between border-b border-stone-200 px-3 py-2 dark:border-stone-800">
				<p className="text-xs font-semibold text-stone-950 dark:text-stone-50">{messages.SCANNER_JOBS}</p>
				<span className="text-[11px] tabular-nums text-muted-foreground">{jobs.length}</span>
			</div>
			{jobs.length ? (
				<div className="min-h-0 flex-1 overflow-auto">
					{jobs.map((job) => {
						const selected = job.id === selectedJobId;
						return (
							<button
								key={job.id}
								type="button"
								onClick={() => onSelectJob(job.id)}
								className={`flex w-full flex-col gap-0.5 border-b border-stone-100 px-3 py-2 text-left dark:border-stone-900 ${
									selected ? "bg-stone-100 dark:bg-stone-900" : "hover:bg-stone-50 dark:hover:bg-stone-900/60"
								}`}
							>
								<div className="flex items-center justify-between gap-2">
									<span className="truncate text-[11px] text-stone-700 dark:text-stone-300">
										{formatBrowserDateTime(job.startedAt)}
									</span>
									<Badge variant={job.status === "failed" || job.status === "runtime-missing" ? "destructive" : "secondary"} className="text-[10px]">
										{job.status}
									</Badge>
								</div>
								<div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
									<span className="truncate font-mono">{job.ref || job.target}</span>
									<span className="shrink-0 tabular-nums">
										{findingCount(job)} · {formatDuration(job.durationMs)}
									</span>
								</div>
							</button>
						);
					})}
				</div>
			) : (
				<div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-muted-foreground">
					{messages.SCANNER_EMPTY_JOBS}
				</div>
			)}
		</div>
	);
}

function FindingsPane({
	findings,
	onOpenFinding,
}: {
	findings: ScannerFinding[];
	onOpenFinding: (finding: ScannerFinding) => void;
}) {
	const messages = getMessage();
	return (
		<div className="flex h-full min-h-0 flex-col overflow-hidden">
			<div className="flex shrink-0 items-center justify-between border-b border-stone-200 px-3 py-2 dark:border-stone-800">
				<p className="text-xs font-semibold text-stone-950 dark:text-stone-50">{messages.SCANNER_FINDINGS}</p>
				<span className="text-[11px] tabular-nums text-muted-foreground">{findings.length}</span>
			</div>
			{findings.length ? (
				<div className="min-h-0 flex-1 overflow-auto">
					{findings.map((item) => {
						const location = [item.path, item.line ? String(item.line) : ""].filter(Boolean).join(":");
						const meta = [item.ruleId, item.scope || item.category, location].filter(Boolean).join("  ·  ");
						return (
							<button
								key={item.id}
								type="button"
								onClick={() => onOpenFinding(item)}
								className="flex w-full items-start gap-3 border-b border-stone-100 px-3 py-2 text-left hover:bg-stone-50 dark:border-stone-900 dark:hover:bg-stone-900/60"
							>
								<span
									className={`mt-0.5 inline-flex shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${severityTone(item.severity)}`}
								>
									{item.severity}
								</span>
								<span className="min-w-0 flex-1">
									<span className="block truncate text-xs font-medium text-stone-900 dark:text-stone-100">
										{item.title}
									</span>
									<span className="mt-0.5 block truncate font-mono text-[10px] text-stone-500 dark:text-stone-400">
										{meta}
									</span>
								</span>
							</button>
						);
					})}
				</div>
			) : (
				<div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-muted-foreground">
					{messages.SCANNER_EMPTY_FINDINGS}
				</div>
			)}
		</div>
	);
}
