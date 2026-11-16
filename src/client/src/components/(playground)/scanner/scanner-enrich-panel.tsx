"use client";

import { useEffect, useState } from "react";
import {
	AlertCircle,
	Ban,
	CheckCircle2,
	Circle,
	Clock,
	Copy,
	FileDiff,
	Loader2,
	RotateCcw,
	ShieldCheck,
	XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import getMessage from "@/constants/messages";
import type {
	ScannerEnrichRun,
	ScannerEnrichStep,
	ScannerFinding,
} from "@/lib/platform/connectors/scanner/types";
import ScannerEnrichDiff from "./scanner-enrich-diff";

function formatDuration(ms?: number): string {
	if (ms == null || ms < 0) return "";
	if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
	const seconds = Math.round(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function formatClock(ms: number): string {
	const seconds = Math.max(0, Math.floor(ms / 1000));
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function useElapsed(startedAt: string, running: boolean): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!running) return;
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [running]);
	return now - new Date(startedAt).getTime();
}

function StepIcon({ status }: { status: ScannerEnrichStep["status"] }) {
	if (status === "done") return <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />;
	if (status === "running") return <Loader2 className="h-4 w-4 animate-spin text-sky-600 dark:text-sky-400" />;
	if (status === "failed") return <XCircle className="h-4 w-4 text-rose-600 dark:text-rose-400" />;
	return <Circle className="h-4 w-4 text-stone-300 dark:text-stone-600" />;
}

function stepTitle(step: ScannerEnrichStep, run: ScannerEnrichRun): string {
	const messages = getMessage();
	if (step.key === "clone") return messages.SCANNER_ENRICH_STEP_CLONE;
	if (step.key === "enrich") return messages.SCANNER_ENRICH_STEP_ENRICH(run.alertNumber);
	if (step.key === "recheck") return messages.SCANNER_ENRICH_STEP_RECHECK(run.ruleId);
	return messages.SCANNER_ENRICH_STEP_DIFF;
}

function Steps({ run }: { run: ScannerEnrichRun }) {
	const messages = getMessage();
	return (
		<ol className="mt-3 space-y-2.5">
			{run.steps.map((step) => {
				const idle = step.status === "pending" || step.status === "skipped";
				const detail =
					[step.detail, formatDuration(step.durationMs)].filter(Boolean).join(" · ") ||
					(step.status === "skipped" ? messages.SCANNER_ENRICH_STEP_SKIPPED : "");
				return (
					<li key={step.key} className="flex gap-2.5">
						<span className="mt-0.5 shrink-0">
							<StepIcon status={step.status} />
						</span>
						<div className="min-w-0">
							<p
								className={`text-xs font-medium ${idle ? "text-stone-400 dark:text-stone-500" : "text-stone-950 dark:text-stone-50"}`}
							>
								{stepTitle(step, run)}
							</p>
							{detail ? (
								<p className="mt-0.5 break-all font-mono text-[11px] text-stone-500 dark:text-stone-400">{detail}</p>
							) : null}
						</div>
					</li>
				);
			})}
		</ol>
	);
}

function LogBox({ lines }: { lines: string[] }) {
	const messages = getMessage();
	return (
		<pre className="mt-3 max-h-56 overflow-auto rounded-md bg-stone-950 p-3 font-mono text-[11px] leading-5 text-stone-100">
			{lines.length ? (
				lines.map((line, index) => (
					<div key={index} className="whitespace-pre-wrap break-all">
						{line}
					</div>
				))
			) : (
				<div className="text-stone-400">{messages.SCANNER_ENRICH_LOG_EMPTY}</div>
			)}
		</pre>
	);
}

function failureTitle(run: ScannerEnrichRun): string {
	const messages = getMessage();
	switch (run.failure) {
		case "still-detected":
			return messages.SCANNER_ENRICH_FAILED_STILL_DETECTED(run.ruleId, run.attempts);
		case "provider":
			return messages.SCANNER_ENRICH_FAILED_PROVIDER;
		case "not-applied":
			return messages.SCANNER_ENRICH_FAILED_NOT_APPLIED;
		case "not-found":
			return messages.SCANNER_ENRICH_FAILED_NOT_FOUND;
		case "clone":
			return messages.SCANNER_ENRICH_FAILED_CLONE;
		case "interrupted":
			return messages.SCANNER_ENRICH_FAILED_INTERRUPTED;
		default:
			return messages.SCANNER_ENRICH_FAILED_ERROR;
	}
}

async function copyText(text: string, success: string) {
	const messages = getMessage();
	try {
		await navigator.clipboard.writeText(text);
		toast.success(success);
	} catch {
		toast.error(messages.SCANNER_ENRICH_COPY_FAILED);
	}
}

const PANEL_TONE: Record<ScannerEnrichRun["status"], string> = {
	running: "border-sky-200 dark:border-sky-900",
	succeeded: "border-emerald-200 dark:border-emerald-900",
	failed: "border-rose-200 dark:border-rose-900",
	cancelled: "border-stone-200 dark:border-stone-800",
};

export default function ScannerEnrichPanel({
	run,
	finding,
	busy,
	onCancel,
	onDiscard,
	onRetry,
}: {
	run: ScannerEnrichRun;
	finding: ScannerFinding;
	busy?: boolean;
	onCancel: () => void;
	onDiscard: () => void;
	onRetry: () => void;
}) {
	const messages = getMessage();
	const running = run.status === "running";
	const elapsed = useElapsed(run.startedAt, running);
	const [showLog, setShowLog] = useState(false);
	const [showPartial, setShowPartial] = useState(false);
	const model = run.model || messages.SCANNER_ENRICH_MODEL_DEFAULT;
	const path = run.path || finding.path;
	const log = run.log || [];
	// The title already states a failed re-check; the LLM's account of its edit says why.
	const failureBody =
		run.failure === "still-detected" && run.explanation ? run.explanation : run.error;

	const discardButton = (
		<Button variant="ghost" size="sm" className="h-8" disabled={busy} onClick={onDiscard}>
			{messages.SCANNER_ENRICH_DISCARD}
		</Button>
	);
	const retryButton = (primary: boolean) => (
		<Button
			variant={primary ? "default" : "outline"}
			size="sm"
			className="h-8 gap-1.5"
			disabled={busy}
			onClick={onRetry}
		>
			<RotateCcw className="h-3.5 w-3.5" />
			{messages.SCANNER_ENRICH_RETRY}
		</Button>
	);

	return (
		<section className={`mt-4 rounded-md border bg-white p-4 dark:bg-stone-950 ${PANEL_TONE[run.status]}`}>
			{running ? (
				<>
					<div className="flex flex-wrap items-center justify-between gap-2">
						<div className="flex min-w-0 items-center gap-2">
							<Loader2 className="h-4 w-4 shrink-0 animate-spin text-sky-600 dark:text-sky-400" />
							<h3 className="truncate text-xs font-semibold text-stone-950 dark:text-stone-50">
								{messages.SCANNER_ENRICH_RUNNING_TITLE(model)}
							</h3>
						</div>
						<div className="flex items-center gap-3">
							<span className="inline-flex items-center gap-1 text-[11px] text-stone-500 dark:text-stone-400">
								<Clock className="h-3.5 w-3.5" />
								{`${formatClock(elapsed)} · ${messages.SCANNER_ENRICH_ATTEMPT(run.attempt, run.attempts)}`}
							</span>
							<Button variant="outline" size="sm" className="h-7" disabled={busy} onClick={onCancel}>
								{messages.CANCEL}
							</Button>
						</div>
					</div>
					<Steps run={run} />
					<LogBox lines={log} />
				</>
			) : null}

			{run.status === "succeeded" ? (
				<>
					<div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
						<FileDiff className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
						<h3 className="text-xs font-semibold text-stone-950 dark:text-stone-50">
							{messages.SCANNER_ENRICH_REVIEW_TITLE}
						</h3>
						<span className="text-[11px] text-stone-500 dark:text-stone-400">
							{messages.SCANNER_ENRICH_REVIEW_META(model, formatDuration(run.durationMs))}
						</span>
						{run.recheck && run.resolved ? (
							<span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
								<ShieldCheck className="h-3.5 w-3.5" />
								<span>{messages.SCANNER_ENRICH_RESOLVED_BADGE(run.ruleId, run.newFindings || 0)}</span>
							</span>
						) : (
							<span className="rounded bg-stone-100 px-1.5 py-0.5 text-[11px] font-medium text-stone-600 dark:bg-stone-800 dark:text-stone-300">
								{messages.SCANNER_ENRICH_NOT_RECHECKED}
							</span>
						)}
					</div>
					{run.explanation ? (
						<p className="mt-3 text-xs leading-5 text-stone-800 dark:text-stone-200">
							<strong className="font-semibold">{messages.SCANNER_ENRICH_EXPLANATION}</strong>{" "}
							<span>{run.explanation}</span>
						</p>
					) : null}
					{run.diff ? (
						<div className="mt-3">
							<ScannerEnrichDiff diff={run.diff} path={path} />
						</div>
					) : null}
					<div className="mt-3 flex flex-wrap justify-end gap-2">
						{discardButton}
						{retryButton(false)}
						<Button
							size="sm"
							className="h-8 gap-1.5"
							disabled={!run.diff}
							onClick={() => void copyText(run.diff || "", messages.SCANNER_ENRICH_DIFF_COPIED)}
						>
							<Copy className="h-3.5 w-3.5" />
							{messages.SCANNER_ENRICH_COPY_DIFF}
						</Button>
					</div>
				</>
			) : null}

			{run.status === "failed" || run.status === "cancelled" ? (
				<>
					<div className="flex gap-2">
						{run.status === "failed" ? (
							<AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
						) : (
							<Ban className="mt-0.5 h-4 w-4 shrink-0 text-stone-500 dark:text-stone-400" />
						)}
						<div className="min-w-0">
							<h3 className="text-xs font-semibold text-stone-950 dark:text-stone-50">
								{run.status === "failed" ? failureTitle(run) : messages.SCANNER_ENRICH_CANCELLED_TITLE}
							</h3>
							{failureBody ? (
								<p className="mt-1 break-words text-xs leading-5 text-stone-600 dark:text-stone-300">{failureBody}</p>
							) : null}
						</div>
					</div>
					<Steps run={run} />
					{showLog ? <LogBox lines={log} /> : null}
					{showPartial && run.partialDiff ? (
						<div className="mt-3">
							<ScannerEnrichDiff diff={run.partialDiff} path={path} />
						</div>
					) : null}
					<div className="mt-3 flex flex-wrap justify-end gap-2">
						{log.length ? (
							<Button variant="ghost" size="sm" className="h-8" onClick={() => setShowLog((value) => !value)}>
								{showLog ? messages.SCANNER_ENRICH_HIDE_LOG : messages.SCANNER_ENRICH_VIEW_LOG}
							</Button>
						) : null}
						{run.partialDiff ? (
							<Button variant="outline" size="sm" className="h-8" onClick={() => setShowPartial((value) => !value)}>
								{showPartial ? messages.SCANNER_ENRICH_HIDE_PARTIAL_DIFF : messages.SCANNER_ENRICH_VIEW_PARTIAL_DIFF}
							</Button>
						) : null}
						{discardButton}
						{retryButton(true)}
					</div>
				</>
			) : null}
		</section>
	);
}
