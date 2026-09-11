"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ResizeablePanel } from "@/components/ui/resizeable-panel";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import DetailShell from "@/components/(playground)/observability/detail-shell";
import AttributeGrid from "@/components/(playground)/observability/attribute-grid";
import getMessage from "@/constants/messages";
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
			setDefaultWidth(Math.min(Math.max(viewportWidth * 0.58, 720), nextMaxWidth));
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

function MetaPill({ label, value }: { label: string; value?: string }) {
	if (!value) return null;
	return (
		<div className="min-w-0 rounded-md border border-stone-200 bg-white px-2 py-1 dark:border-stone-800 dark:bg-stone-950">
			<div className="text-[10px] uppercase tracking-wide text-stone-500 dark:text-stone-400">{label}</div>
			<div className="max-w-80 truncate font-mono text-[11px] font-medium text-stone-900 dark:text-stone-100" title={value}>
				{value}
			</div>
		</div>
	);
}

function Stat({ label, value }: { label: string; value?: string }) {
	return (
		<div className="rounded-md bg-stone-100 px-2.5 py-1.5 dark:bg-stone-900">
			<div className="text-[11px] text-stone-500 dark:text-stone-400">{label}</div>
			<div className="mt-0.5 truncate text-xs font-semibold text-stone-900 dark:text-stone-100">
				{value || "—"}
			</div>
		</div>
	);
}

export default function ScannerFindingSheet({
	open,
	finding,
	job,
	onClose,
}: {
	open: boolean;
	finding: ScannerFinding | null;
	job?: ScannerJob | null;
	onClose: () => void;
}) {
	const messages = getMessage();
	const location = finding
		? [finding.path, finding.line ? `${finding.line}${finding.endLine && finding.endLine !== finding.line ? `-${finding.endLine}` : ""}` : ""]
				.filter(Boolean)
				.join(":")
		: "";
	const overview = useMemo(() => {
		if (!finding) return {};
		return {
			rule_id: finding.ruleId,
			severity: finding.severity,
			scope: finding.scope,
			category: finding.category,
			tool: finding.toolName,
			path: location || undefined,
			confidence: finding.confidence,
			job: job?.id,
			target: job?.target,
			...(finding.extras || {}),
		};
	}, [finding, job?.id, job?.target, location]);

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
					<DetailShell
						compact
						fill
						title={finding.title}
						actions={
							<Button
								variant="outline"
								size="sm"
								className="h-7 w-7 border-stone-200 bg-white p-0 text-stone-600 hover:bg-stone-100 hover:text-stone-950 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-50"
								onClick={onClose}
								title={messages.OBSERVABILITY_CLOSE}
							>
								<X className="h-4 w-4" />
							</Button>
						}
						headerMeta={
							<div className="space-y-2">
								<div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
									<Stat label={messages.SCANNER_SEVERITY} value={finding.severity} />
									<Stat label={messages.SCANNER_RULE} value={finding.ruleId} />
									<Stat label={messages.SCANNER_SCOPE} value={finding.scope || finding.category} />
									<Stat label={messages.SCANNER_FINDING_CONFIDENCE} value={finding.confidence} />
								</div>
								<div className="flex flex-wrap gap-1.5">
									<MetaPill label={messages.SCANNER_PATH} value={location || undefined} />
									<MetaPill label={messages.SCANNER_TOOL_NAME} value={finding.toolName} />
									<MetaPill label={messages.SCANNER_JOB_ID} value={job?.id} />
									<MetaPill label={messages.SCANNER_CLI_VERSION} value={job?.cliVersion} />
									<MetaPill label={messages.SCANNER_TARGET} value={job?.target} />
								</div>
							</div>
						}
					>
						<div className="min-h-0 flex-1 overflow-auto">
							<Tabs defaultValue="overview" className="min-w-0">
								<TabsList
									aria-label={messages.SCANNER_FINDINGS}
									className="h-8 w-max min-w-full justify-start gap-0 rounded-none border-b border-stone-200 bg-transparent p-0 dark:border-stone-800"
								>
									<TabsTrigger
										value="overview"
										className="h-8 shrink-0 rounded-none border-b-2 border-transparent bg-transparent px-2.5 text-xs shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-stone-900 data-[state=active]:shadow-none dark:data-[state=active]:text-stone-50"
									>
										{messages.SCANNER_FINDING_OVERVIEW}
									</TabsTrigger>
									<TabsTrigger
										value="details"
										className="h-8 shrink-0 rounded-none border-b-2 border-transparent bg-transparent px-2.5 text-xs shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-stone-900 data-[state=active]:shadow-none dark:data-[state=active]:text-stone-50"
									>
										{messages.SCANNER_FINDING_DETAIL}
									</TabsTrigger>
									{finding.fix ? (
										<TabsTrigger
											value="fix"
											className="h-8 shrink-0 rounded-none border-b-2 border-transparent bg-transparent px-2.5 text-xs shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-stone-900 data-[state=active]:shadow-none dark:data-[state=active]:text-stone-50"
										>
											{messages.SCANNER_FINDING_FIX}
										</TabsTrigger>
									) : null}
								</TabsList>
								<TabsContent value="overview" className="mt-3">
									<AttributeGrid title={finding.ruleId} data={overview} />
								</TabsContent>
								<TabsContent value="details" className="mt-3">
									{finding.message ? (
										<pre className="max-w-full whitespace-pre-wrap break-words rounded-md border border-stone-200 bg-stone-50 p-3 font-sans text-xs leading-5 text-stone-800 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200">
											{finding.message}
										</pre>
									) : (
										<p className="px-3 text-xs text-muted-foreground">{messages.SCANNER_FINDING_NO_DETAIL}</p>
									)}
									{finding.helpUrl ? (
										<a
											href={finding.helpUrl}
											target="_blank"
											rel="noreferrer noopener"
											className="mt-3 inline-flex px-3 text-xs text-primary underline underline-offset-2"
										>
											{messages.SCANNER_FINDING_DOCS}
										</a>
									) : null}
								</TabsContent>
								{finding.fix ? (
									<TabsContent value="fix" className="mt-3">
										<pre className="max-w-full whitespace-pre-wrap break-words rounded-md border border-stone-200 bg-stone-50 p-3 font-sans text-xs leading-5 text-stone-800 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200">
											{finding.fix}
										</pre>
									</TabsContent>
								) : null}
							</Tabs>
						</div>
					</DetailShell>
				</ResizableFindingSheet>
			</SheetContent>
		</Sheet>
	);
}
