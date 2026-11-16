"use client";

import { useRef, useState } from "react";
import {
	AlertTriangle,
	Check,
	Clock,
	Copy,
	Download,
	FileCode2,
	FileText,
	Layers,
	RefreshCw,
	ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import Markdown from "@/components/common/markdown";
import { formatDuration, Stat } from "@/components/(playground)/scanner/scanner-workspace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@/components/ui/select";
import getMessage from "@/constants/messages";
import { formatBrowserDateTime, formatDate } from "@/utils/date";
import { forgeSkillPreviewMarkdown } from "@/lib/platform/connectors/scanner/forge-skill";
import type { ScannerForgeCheck, ScannerForgeRun } from "@/lib/platform/connectors/scanner/types";

type SkillMode = "preview" | "raw";

const SHORT_SHA = 7;
const COPIED_RESET_MS = 1500;

function shortSha(sha?: string): string {
	return sha ? sha.slice(0, SHORT_SHA) : "";
}

export function ScannerForgeStatusBadge({ status }: { status: "running" | "current" | "stale" | "failed" }) {
	const messages = getMessage();
	const label = {
		running: messages.SCANNER_FORGE_STATUS_RUNNING,
		current: messages.SCANNER_FORGE_STATUS_CURRENT,
		stale: messages.SCANNER_FORGE_STATUS_STALE,
		failed: messages.SCANNER_FORGE_STATUS_FAILED,
	}[status];
	const tone = {
		running: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/70 dark:bg-blue-950/40 dark:text-blue-300",
		current: "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900/70 dark:bg-teal-950/40 dark:text-teal-300",
		stale: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-300",
		failed: "border-error/30 bg-error/5 text-error dark:bg-error/10",
	}[status];
	return (
		<Badge variant="outline" className={`h-5 px-1.5 text-[10px] font-medium ${tone}`}>
			{label}
		</Badge>
	);
}

export function ScannerForgeRunPicker({
	runs,
	selectedRun,
	onSelectRun,
}: {
	runs: ScannerForgeRun[];
	selectedRun: ScannerForgeRun;
	onSelectRun: (id: string) => void;
}) {
	const messages = getMessage();
	return (
		<Select value={selectedRun.id} onValueChange={onSelectRun}>
			<SelectTrigger
				aria-label={messages.SCANNER_FORGE_RUN_LABEL}
				className="h-9 w-[13.5rem] shrink-0 gap-2 bg-white px-2 text-left text-xs dark:bg-stone-950 [&>span]:line-clamp-none [&>span]:flex [&>span]:min-w-0 [&>span]:flex-1 [&>svg]:ml-0 [&>svg]:size-3.5 [&>svg]:shrink-0"
			>
				<span className="flex min-w-0 flex-1 items-center gap-2">
					<Clock className="size-3.5 shrink-0 text-stone-500" />
					<span className="min-w-0 flex-1 text-left leading-tight">
						<span className="block text-[10px] font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">
							{messages.SCANNER_FORGE_RUN_LABEL}
						</span>
						<span className="block truncate font-medium text-stone-900 dark:text-stone-100">
							{formatBrowserDateTime(selectedRun.startedAt)}
						</span>
					</span>
				</span>
			</SelectTrigger>
			<SelectContent align="end" className="w-72">
				{runs.map((run) => (
					<SelectItem key={run.id} value={run.id} textValue={formatBrowserDateTime(run.startedAt)}>
						<span className="flex min-w-0 flex-col">
							<span className="truncate">{formatBrowserDateTime(run.startedAt)}</span>
							<span className="truncate text-[10px] text-muted-foreground">
								{messages.SCANNER_JOB_RUN_OPTION([run.status, run.policies.join(", "), run.cliVersion])}
							</span>
						</span>
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

export default function ScannerForgeSkillView({
	run,
	detail,
	check,
	runs,
	onSelectRun,
	onRegenerate,
}: {
	run: ScannerForgeRun;
	detail: ScannerForgeRun;
	check?: ScannerForgeCheck;
	runs: ScannerForgeRun[];
	onSelectRun: (id: string) => void;
	onRegenerate: (run: ScannerForgeRun) => void;
}) {
	const messages = getMessage();
	const [mode, setMode] = useState<SkillMode>("preview");
	const [copied, setCopied] = useState(false);
	const previewRef = useRef<HTMLDivElement>(null);
	const content = detail.content || "";
	const summary = detail.summary || run.summary;
	const stamp = summary?.stamp;
	const stale = check?.status === "stale";
	const counts = summary?.severityCounts || { critical: 0, high: 0, medium: 0, low: 0 };
	const sha = shortSha(stamp?.rulesSha);
	const title = [summary?.name, run.fileName].filter(Boolean).join(" · ");
	const subtitle = [
		summary?.description,
		run.cliVersion ? messages.SCANNER_FORGE_GENERATED_BY(run.cliVersion) : undefined,
	]
		.filter(Boolean)
		.join(" · ");

	const copy = () => {
		const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
		if (!clipboard?.writeText) {
			toast.error(messages.SCANNER_FORGE_COPY_FAILED);
			return;
		}
		void clipboard.writeText(content).then(
			() => {
				toast.success(messages.SCANNER_FORGE_COPIED);
				setCopied(true);
				window.setTimeout(() => setCopied(false), COPIED_RESET_MS);
			},
			() => toast.error(messages.SCANNER_FORGE_COPY_FAILED)
		);
	};

	const download = () => {
		const url = URL.createObjectURL(new Blob([content], { type: "text/markdown" }));
		const link = document.createElement("a");
		link.href = url;
		link.download = run.fileName;
		link.click();
		URL.revokeObjectURL(url);
	};

	const jumpTo = (heading: string) => {
		setMode("preview");
		window.requestAnimationFrame(() => {
			const target = Array.from(previewRef.current?.querySelectorAll("h2, h3") || []).find(
				(node) => node.textContent?.trim() === heading
			);
			target?.scrollIntoView({ behavior: "smooth", block: "start" });
		});
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3">
			<div className="mb-2 space-y-2">
				<div className="flex items-start justify-between gap-3">
					<div className="min-w-0">
						<div className="flex min-w-0 items-center gap-2">
							<FileCode2 className="size-4 shrink-0 text-teal-700 dark:text-teal-300" />
							<h2 className="truncate text-sm font-semibold text-stone-950 dark:text-stone-50">{title}</h2>
							{check && check.status !== "error" ? (
								<ScannerForgeStatusBadge status={stale ? "stale" : "current"} />
							) : null}
						</div>
						{subtitle ? (
							<p className="mt-0.5 truncate text-[11px] text-muted-foreground">{subtitle}</p>
						) : null}
					</div>
					<div className="flex shrink-0 items-center gap-1.5">
						<Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={copy}>
							{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
							{copied ? messages.SCANNER_FORGE_COPIED_LABEL : messages.SCANNER_FORGE_COPY}
						</Button>
						<Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={download}>
							<Download className="size-3.5" />
							{messages.SCANNER_FORGE_DOWNLOAD}
						</Button>
						<Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => onRegenerate(run)}>
							<RefreshCw className="size-3.5" />
							{messages.SCANNER_FORGE_REGENERATE}
						</Button>
						<ScannerForgeRunPicker runs={runs} selectedRun={run} onSelectRun={onSelectRun} />
					</div>
				</div>

				{stale ? (
					<div className="flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900/70 dark:bg-amber-950/30">
						<div className="flex min-w-0 items-start gap-2">
							<AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-700 dark:text-amber-300" />
							<div className="min-w-0">
								<p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
									{messages.SCANNER_FORGE_STALE_TITLE}
								</p>
								{check?.message ? (
									<p className="mt-0.5 break-words font-mono text-[11px] text-amber-800 dark:text-amber-300">
										{messages.SCANNER_FORGE_CHECK_LINE(check.message)}
									</p>
								) : null}
							</div>
						</div>
						<Button size="sm" className="h-8 shrink-0 gap-1.5" onClick={() => onRegenerate(run)}>
							<RefreshCw className="size-3.5" />
							{messages.SCANNER_FORGE_REGENERATE}
						</Button>
					</div>
				) : null}

				<div className="grid grid-cols-3 gap-1.5 lg:grid-cols-6">
					<Stat
						icon={<Layers className="h-3 w-3" />}
						label={messages.SCANNER_FORGE_POLICIES}
						value={run.policies.join(", ")}
					/>
					<Stat
						icon={<FileText className="h-3 w-3" />}
						label={messages.SCANNER_FORGE_RULES}
						value={String(summary?.ruleCount ?? 0)}
					/>
					<Stat
						icon={<ShieldAlert className="h-3 w-3" />}
						label={counts.critical ? messages.SCANNER_FORGE_STAT_CRITICAL_HIGH : messages.SCANNER_HIGH}
						value={
							counts.critical
								? messages.SCANNER_FORGE_PAIR(counts.critical, counts.high)
								: String(counts.high)
						}
					/>
					<Stat
						icon={<AlertTriangle className="h-3 w-3" />}
						label={messages.SCANNER_FORGE_STAT_MEDIUM_LOW}
						value={messages.SCANNER_FORGE_PAIR(counts.medium, counts.low)}
					/>
					<Stat
						icon={<FileCode2 className="h-3 w-3" />}
						label={messages.SCANNER_FORGE_STAT_RULES_VERSION}
						value={
							sha
								? stale
									? messages.SCANNER_FORGE_RULES_VERSION_STALE(sha)
									: messages.SCANNER_FORGE_RULES_VERSION_VALUE(sha, stamp?.schema)
								: undefined
						}
					/>
					<Stat
						icon={<Clock className="h-3 w-3" />}
						label={messages.SCANNER_DURATION}
						value={formatDuration(run.durationMs)}
					/>
				</div>
			</div>

			<div className="flex min-h-0 flex-1 overflow-hidden rounded-md border border-stone-200 dark:border-stone-800">
				<nav
					aria-label={messages.SCANNER_FORGE_OUTLINE}
					className="hidden w-64 shrink-0 overflow-y-auto border-r border-stone-200 p-3 dark:border-stone-800 md:block"
				>
					<p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">
						{messages.SCANNER_FORGE_OUTLINE}
					</p>
					<div className="space-y-3">
						{(summary?.sections || []).map((section) => (
							<div key={section.title}>
								<button
									type="button"
									onClick={() => jumpTo(section.title)}
									className="w-full text-left text-xs font-semibold text-stone-900 hover:underline dark:text-stone-100"
								>
									{section.title}
								</button>
								<div className="mt-1 space-y-0.5">
									{section.groups.map((group) => (
										<button
											key={`${section.title}-${group.title}`}
											type="button"
											onClick={() => jumpTo(group.title)}
											className="flex w-full items-center justify-between gap-2 rounded px-1.5 py-0.5 text-left text-xs text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-900"
										>
											<span className="truncate">{group.title}</span>
											<span className="font-mono text-[11px] tabular-nums text-stone-400">{group.ruleCount}</span>
										</button>
									))}
								</div>
							</div>
						))}
					</div>
					{stamp?.generated && sha ? (
						<p className="mt-4 text-[11px] leading-4 text-muted-foreground">
							{messages.SCANNER_FORGE_OUTLINE_FOOTER(
								formatDate(stamp.generated),
								sha,
								stamp.schema || "—"
							)}
						</p>
					) : null}
				</nav>

				<div className="flex min-w-0 flex-1 flex-col overflow-hidden">
					<div className="flex shrink-0 items-center justify-between gap-2 border-b border-stone-200 px-2 py-1.5 dark:border-stone-800">
						<div role="tablist" className="flex items-center gap-1">
							{(["preview", "raw"] as const).map((item) => (
								<button
									key={item}
									type="button"
									role="tab"
									aria-selected={mode === item}
									onClick={() => setMode(item)}
									className={`h-7 rounded-md px-2.5 text-xs font-medium ${
										mode === item
											? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900"
											: "text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-900"
									}`}
								>
									{item === "preview" ? messages.SCANNER_FORGE_PREVIEW : messages.SCANNER_FORGE_RAW}
								</button>
							))}
						</div>
						{summary ? (
							<span className="font-mono text-[11px] text-muted-foreground">
								{messages.SCANNER_FORGE_SIZE(summary.lineCount, (summary.byteLength / 1024).toFixed(1))}
							</span>
						) : null}
					</div>
					<div className="min-h-0 flex-1 overflow-y-auto">
						{mode === "preview" ? (
							<div ref={previewRef} className="max-w-4xl px-5 py-4 text-sm leading-6 text-stone-800 dark:text-stone-200">
								<Markdown content={forgeSkillPreviewMarkdown(content)} />
							</div>
						) : (
							<pre className="whitespace-pre-wrap break-words px-4 py-3 font-mono text-xs leading-5 text-stone-800 dark:text-stone-200">
								{content}
							</pre>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
