"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ResizeablePanel } from "@/components/ui/resizeable-panel";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import getMessage from "@/constants/messages";
import { formatBrowserDateTime } from "@/utils/date";
import type { LiveSignal } from "@/lib/platform/realtime/signals";

const DETAIL_SHEET_CONTENT_CLASS =
	"right-2 top-2 bottom-2 flex h-auto w-auto max-w-none flex-col gap-0 border-0 bg-transparent p-0 shadow-none focus-visible:outline-none sm:max-w-none";

const STATUS_CLASSES: Record<string, string> = {
	ok: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
	error: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
	unset: "bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300",
};

function ResizableSignalSheet({ children }: { children: ReactNode }) {
	const [maxWidth, setMaxWidth] = useState(1100);
	const [defaultWidth, setDefaultWidth] = useState(640);

	useEffect(() => {
		const updateBounds = () => {
			const viewportWidth = window.innerWidth;
			const nextMaxWidth = Math.max(380, viewportWidth - 32);
			setMaxWidth(nextMaxWidth);
			setDefaultWidth(Math.min(Math.max(viewportWidth * 0.45, 560), nextMaxWidth));
		};
		updateBounds();
		window.addEventListener("resize", updateBounds);
		return () => window.removeEventListener("resize", updateBounds);
	}, []);

	return (
		<ResizeablePanel
			defaultWidth={defaultWidth}
			minWidth={380}
			maxWidth={maxWidth}
			handlePosition="left"
			className="h-full max-w-[calc(100vw-1rem)] rounded-md bg-white shadow-2xl dark:bg-stone-950"
			handleClassName="opacity-100 border-stone-300 bg-white dark:border-stone-700 dark:bg-stone-900"
		>
			<div className="flex h-full min-h-0 flex-col overflow-hidden">{children}</div>
		</ResizeablePanel>
	);
}

function Field({ label, value, mono = false }: { label: string; value?: ReactNode; mono?: boolean }) {
	if (value == null || value === "") return null;
	return (
		<div className="flex flex-col gap-0.5 border-b border-stone-100 py-2 last:border-b-0 dark:border-stone-900">
			<div className="text-[10px] uppercase tracking-wide text-stone-500 dark:text-stone-400">{label}</div>
			<div
				className={`break-all text-[11px] font-medium text-stone-900 dark:text-stone-100 ${mono ? "font-mono" : ""}`}
			>
				{value}
			</div>
		</div>
	);
}

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="mt-5 first:mt-0">
			<h3 className="text-xs font-semibold text-stone-950 dark:text-stone-50">{title}</h3>
			<div className="mt-2 rounded-md border border-stone-200 px-3 dark:border-stone-800">{children}</div>
		</section>
	);
}

function latency(ms: number): string {
	return ms >= 1000 ? `${(ms / 1000).toFixed(3)}s` : `${ms.toFixed(1)}ms`;
}

export default function SignalDetailSheet({
	signal,
	onClose,
}: {
	signal: LiveSignal | null;
	onClose: () => void;
}) {
	const m = getMessage();
	if (!signal) return null;
	const attributes = Object.entries(signal.attributes || {}).sort(([a], [b]) => a.localeCompare(b));
	const statusLabel =
		signal.status === "ok"
			? m.REALTIME_SIGNAL_STATUS_OK
			: signal.status === "error"
				? m.REALTIME_SIGNAL_STATUS_ERROR
				: signal.status;

	return (
		<Sheet modal={false} open={!!signal} onOpenChange={(next) => !next && onClose()}>
			<SheetContent side="right" className={DETAIL_SHEET_CONTENT_CLASS} displayOverlay={false} displayClose={false}>
				<ResizableSignalSheet>
					<div className="flex shrink-0 items-center justify-between gap-2 border-b border-stone-200 px-3 py-2 dark:border-stone-800">
						<Button
							variant="ghost"
							size="sm"
							className="h-7 gap-1.5 px-2 text-xs text-stone-600 dark:text-stone-300"
							onClick={onClose}
						>
							<ArrowLeft className="h-3.5 w-3.5" />
							{m.REALTIME_SIGNAL_DETAIL_CLOSE}
						</Button>
						<div className="flex items-center gap-2">
							{signal.spanId ? (
								<Button asChild variant="outline" size="sm" className="h-7 gap-1.5 px-2 text-xs">
									<Link href={`/telemetry/traces/${encodeURIComponent(signal.spanId)}?from=${encodeURIComponent(typeof window === "undefined" ? "/alerts" : window.location.pathname)}`}>
										<ExternalLink className="h-3.5 w-3.5" />
										{m.REALTIME_SIGNAL_DETAIL_OPEN_TRACE}
									</Link>
								</Button>
							) : null}
							<Button
								variant="outline"
								size="sm"
								className="h-7 w-7 border-stone-200 bg-white p-0 text-stone-600 hover:bg-stone-100 hover:text-stone-950 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-50"
								onClick={onClose}
								title={m.REALTIME_SIGNAL_DETAIL_CLOSE}
							>
								<X className="h-4 w-4" />
							</Button>
						</div>
					</div>

					<div className="min-h-0 flex-1 overflow-auto p-4">
						<div className="flex flex-wrap items-start justify-between gap-2">
							<div className="min-w-0">
								<h2 className="truncate text-base font-semibold leading-6 text-stone-950 dark:text-stone-50">
									{signal.spanName || signal.operation || signal.model || "—"}
								</h2>
								<p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
									{[signal.service, signal.model || signal.provider].filter(Boolean).join(" · ")}
								</p>
							</div>
							<span
								className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_CLASSES[signal.status] || STATUS_CLASSES.unset}`}
							>
								{statusLabel}
							</span>
						</div>

						<div className="mt-4">
							<Section title={m.REALTIME_SIGNAL_DETAIL_OVERVIEW}>
								<Field label={m.REALTIME_SIGNAL_FIELD_TIMESTAMP} value={`${formatBrowserDateTime(signal.timestamp)} (${signal.timestamp})`} />
								<Field label={m.REALTIME_SIGNALS_COLUMN_SERVICE} value={signal.service} />
								<Field label={m.REALTIME_SIGNAL_FIELD_SPAN_NAME} value={signal.spanName} />
								<Field label={m.REALTIME_SIGNAL_FIELD_OPERATION} value={signal.operation} />
								<Field label={m.REALTIME_SIGNAL_FIELD_PROVIDER} value={signal.provider} />
								<Field label={m.REALTIME_SIGNALS_COLUMN_MODEL} value={signal.model} mono />
								<Field label={m.REALTIME_SIGNALS_COLUMN_STATUS} value={statusLabel} />
								<Field label={m.REALTIME_SIGNAL_FIELD_HTTP_STATUS} value={signal.httpStatus || undefined} />
								<Field label={m.REALTIME_SIGNALS_COLUMN_LATENCY} value={latency(signal.durationMs)} />
							</Section>

							<Section title={m.REALTIME_SIGNAL_DETAIL_USAGE}>
								<Field label={m.REALTIME_SIGNAL_FIELD_INPUT_TOKENS} value={signal.inputTokens.toLocaleString()} />
								<Field label={m.REALTIME_SIGNAL_FIELD_OUTPUT_TOKENS} value={signal.outputTokens.toLocaleString()} />
								<Field label={m.REALTIME_SIGNALS_COLUMN_TOKENS} value={signal.totalTokens.toLocaleString()} />
								<Field
									label={m.REALTIME_SIGNALS_COLUMN_COST}
									value={signal.cost === null ? "—" : `$${signal.cost.toFixed(6)}`}
								/>
							</Section>

							<Section title={m.REALTIME_SIGNAL_DETAIL_IDENTIFIERS}>
								<Field label={m.REALTIME_SIGNAL_FIELD_TRACE_ID} value={signal.traceId} mono />
								<Field label={m.REALTIME_SIGNAL_FIELD_SPAN_ID} value={signal.spanId} mono />
							</Section>

							<Section title={m.REALTIME_SIGNAL_DETAIL_ATTRIBUTES}>
								{attributes.length ? (
									attributes.map(([key, value]) => <Field key={key} label={key} value={value} mono />)
								) : (
									<p className="py-2 text-[11px] text-stone-500 dark:text-stone-400">
										{m.REALTIME_SIGNAL_DETAIL_ATTRIBUTES_EMPTY}
									</p>
								)}
							</Section>
						</div>
					</div>
				</ResizableSignalSheet>
			</SheetContent>
		</Sheet>
	);
}
