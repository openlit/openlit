"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ResizeablePanel } from "@/components/ui/resizeable-panel";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import getMessage from "@/constants/messages";
import { formatBrowserDateTime } from "@/utils/date";
import type { ScannerFinding, ScannerJob } from "@/lib/platform/connectors/scanner/types";

const DETAIL_SHEET_CONTENT_CLASS =
	"right-2 top-2 bottom-2 flex h-auto w-auto max-w-none flex-col gap-0 border-0 bg-transparent p-0 shadow-none focus-visible:outline-none sm:max-w-none";

function ResizableFindingSheet({ children }: { children: ReactNode }) {
	const [maxWidth, setMaxWidth] = useState(1200);
	const [defaultWidth, setDefaultWidth] = useState(880);

	useEffect(() => {
		const updateBounds = () => {
			const viewportWidth = window.innerWidth;
			const nextMaxWidth = Math.max(420, viewportWidth - 32);
			setMaxWidth(nextMaxWidth);
			setDefaultWidth(Math.min(Math.max(viewportWidth * 0.62, 760), nextMaxWidth));
		};
		updateBounds();
		window.addEventListener("resize", updateBounds);
		return () => window.removeEventListener("resize", updateBounds);
	}, []);

	return (
		<ResizeablePanel
			defaultWidth={defaultWidth}
			minWidth={420}
			maxWidth={maxWidth}
			handlePosition="left"
			className="h-full max-w-[calc(100vw-1rem)] rounded-md bg-white shadow-2xl dark:bg-stone-950"
			handleClassName="opacity-100 border-stone-300 bg-white dark:border-stone-700 dark:bg-stone-900"
		>
			<div className="flex h-full min-h-0 flex-col overflow-hidden">{children}</div>
		</ResizeablePanel>
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
	return "bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300";
}

function MetaRow({ label, value }: { label: string; value?: string | number | null }) {
	if (value == null || value === "") return null;
	return (
		<div className="flex flex-col gap-0.5 border-b border-stone-100 py-2 last:border-b-0 dark:border-stone-900">
			<div className="text-[10px] uppercase tracking-wide text-stone-500 dark:text-stone-400">{label}</div>
			<div className="break-all font-mono text-[11px] font-medium text-stone-900 dark:text-stone-100">{String(value)}</div>
		</div>
	);
}

export default function ScannerFindingSheet({
	open,
	finding,
	alertNumber,
	job,
	onClose,
}: {
	open: boolean;
	finding: ScannerFinding | null;
	alertNumber?: number;
	job?: ScannerJob | null;
	onClose: () => void;
}) {
	const messages = getMessage();
	const location = finding
		? [finding.path, finding.line ? `${finding.line}${finding.endLine && finding.endLine !== finding.line ? `-${finding.endLine}` : ""}` : ""]
				.filter(Boolean)
				.join(":")
		: "";

	if (!finding) return null;

	return (
		<Sheet modal={false} open={open} onOpenChange={(next) => !next && onClose()}>
			<SheetContent
				side="right"
				className={DETAIL_SHEET_CONTENT_CLASS}
				displayOverlay={false}
				displayClose={false}
			>
				<ResizableFindingSheet>
					<div className="flex h-full min-h-0 flex-col overflow-hidden">
						<div className="flex shrink-0 items-center justify-between gap-2 border-b border-stone-200 px-3 py-2 dark:border-stone-800">
							<Button
								variant="ghost"
								size="sm"
								className="h-7 gap-1.5 px-2 text-xs text-stone-600 dark:text-stone-300"
								onClick={onClose}
							>
								<ArrowLeft className="h-3.5 w-3.5" />
								{messages.SCANNER_BACK_TO_FINDINGS}
							</Button>
							<Button
								variant="outline"
								size="sm"
								className="h-7 w-7 border-stone-200 bg-white p-0 text-stone-600 hover:bg-stone-100 hover:text-stone-950 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-50"
								onClick={onClose}
								title={messages.OBSERVABILITY_CLOSE}
							>
								<X className="h-4 w-4" />
							</Button>
						</div>
						<div className="min-h-0 flex-1 overflow-auto">
							<div className="grid min-h-full gap-0 lg:grid-cols-[minmax(0,1fr)_240px]">
								<div className="min-w-0 border-b border-stone-200 p-4 lg:border-b-0 lg:border-r dark:border-stone-800">
									<div className="flex flex-wrap items-start justify-between gap-2">
										<div className="min-w-0">
											<p className="font-mono text-[11px] text-stone-400">
												{alertNumber ? messages.SCANNER_FINDING_NUMBER(alertNumber) : null}
											</p>
											<h2 className="mt-1 text-base font-semibold leading-6 text-stone-950 dark:text-stone-50">
												{finding.title}
											</h2>
											<p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
												{messages.SCANNER_SEVERITY_WITH_LEVEL(finding.severity)}
												{finding.ruleId ? ` · ${finding.ruleId}` : ""}
											</p>
										</div>
										<span
											className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${severityTone(finding.severity)}`}
										>
											{finding.severity}
										</span>
									</div>
									{location ? (
										<p className="mt-3 truncate font-mono text-[11px] text-stone-500 dark:text-stone-400" title={location}>
											{messages.SCANNER_PATH}: {location}
										</p>
									) : null}

									<section className="mt-5">
										<h3 className="text-xs font-semibold text-stone-950 dark:text-stone-50">
											{messages.SCANNER_FINDING_DETAIL}
										</h3>
										{finding.message ? (
											<pre className="mt-2 max-w-full whitespace-pre-wrap break-words rounded-md border border-stone-200 bg-stone-50 p-3 font-sans text-xs leading-5 text-stone-800 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200">
												{finding.message}
											</pre>
										) : (
											<p className="mt-2 text-xs text-muted-foreground">{messages.SCANNER_FINDING_NO_DETAIL}</p>
										)}
										{finding.helpUrl ? (
											<a
												href={finding.helpUrl}
												target="_blank"
												rel="noreferrer noopener"
												className="mt-3 inline-flex text-xs text-primary underline underline-offset-2"
											>
												{messages.SCANNER_FINDING_DOCS}
											</a>
										) : null}
									</section>

									{finding.fix ? (
										<section className="mt-5">
											<h3 className="text-xs font-semibold text-stone-950 dark:text-stone-50">
												{messages.SCANNER_FINDING_FIX}
											</h3>
											<pre className="mt-2 max-w-full whitespace-pre-wrap break-words rounded-md border border-stone-200 bg-stone-50 p-3 font-sans text-xs leading-5 text-stone-800 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200">
												{finding.fix}
											</pre>
										</section>
									) : null}
								</div>
								<aside className="bg-stone-50 p-4 dark:bg-stone-900/40">
									<MetaRow label={messages.SCANNER_SEVERITY} value={finding.severity} />
									<MetaRow label={messages.SCANNER_RULE} value={finding.ruleId} />
									<MetaRow label={messages.SCANNER_SCOPE} value={finding.scope || finding.category} />
									<MetaRow label={messages.SCANNER_FINDING_CONFIDENCE} value={finding.confidence} />
									<MetaRow label={messages.SCANNER_PATH} value={location || undefined} />
									<MetaRow label={messages.SCANNER_TOOL_NAME} value={finding.toolName} />
									<MetaRow label={messages.SCANNER_DETECTED} value={job?.startedAt ? formatBrowserDateTime(job.startedAt) : undefined} />
									<MetaRow label={messages.SCANNER_JOB_ID} value={job?.id} />
									<MetaRow label={messages.SCANNER_CLI_VERSION} value={job?.cliVersion} />
									<MetaRow label={messages.SCANNER_TARGET} value={job?.target} />
									<MetaRow label={messages.SCANNER_FIELD_REF} value={job?.ref} />
									{finding.extras
										? Object.entries(finding.extras).map(([key, value]) => (
												<MetaRow key={key} label={key} value={value} />
											))
										: null}
								</aside>
							</div>
						</div>
					</div>
				</ResizableFindingSheet>
			</SheetContent>
		</Sheet>
	);
}
