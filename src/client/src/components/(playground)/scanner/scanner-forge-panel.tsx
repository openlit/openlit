"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, Clock, Hammer, History, Loader2 } from "lucide-react";
import ScannerForgeSkillView, {
	ScannerForgeRunPicker,
} from "@/components/(playground)/scanner/scanner-forge-skill-view";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import getMessage from "@/constants/messages";
import { getRequestHeaders } from "@/utils/api";
import { formatBrowserDateTime } from "@/utils/date";
import type {
	ScannerForgeCheck,
	ScannerForgePolicySource,
	ScannerForgeRun,
} from "@/lib/platform/connectors/scanner/types";

export type ScannerForgeInFlight = {
	startedAt: number;
	policies: string[];
	policySource: ScannerForgePolicySource;
	rulesRef?: string;
	command: string;
};

export type ScannerForgeRunState = {
	detail?: ScannerForgeRun;
	check?: ScannerForgeCheck;
	loading: boolean;
	error?: string;
};

async function readJson<T>(response: Response, fallback: string): Promise<T> {
	const body = await response.json().catch(() => null);
	if (!response.ok) {
		const message = typeof body === "string" ? body : body?.err;
		throw new Error(message || fallback);
	}
	return body as T;
}

/** Loads a succeeded forge run's SKILL.md, then asks the CLI whether it is still current. */
export function useScannerForgeRun(connectorId?: string, run?: ScannerForgeRun): ScannerForgeRunState {
	const messages = getMessage();
	const [state, setState] = useState<ScannerForgeRunState>({ loading: false });
	const runId = run?.status === "succeeded" ? run.id : undefined;

	useEffect(() => {
		if (!connectorId || !runId) {
			setState({ loading: false });
			return;
		}
		const controller = new AbortController();
		const base = `/api/scanners/${encodeURIComponent(connectorId)}/forge/${encodeURIComponent(runId)}`;
		setState({ loading: true });
		void (async () => {
			try {
				const response = await fetch(base, { headers: getRequestHeaders(), signal: controller.signal });
				const { run: detail } = await readJson<{ run: ScannerForgeRun }>(
					response,
					messages.SCANNER_FORGE_LOAD_FAILED
				);
				if (controller.signal.aborted) return;
				setState({ detail, loading: false });
				const checkResponse = await fetch(`${base}/check`, {
					headers: getRequestHeaders(),
					signal: controller.signal,
				});
				const { check } = await readJson<{ check: ScannerForgeCheck }>(
					checkResponse,
					messages.SCANNER_FORGE_CHECK_FAILED
				);
				if (!controller.signal.aborted) setState({ detail, check, loading: false });
			} catch (error) {
				if (controller.signal.aborted) return;
				const message = error instanceof Error ? error.message : messages.SCANNER_FORGE_LOAD_FAILED;
				setState((current) =>
					current.detail
						? { ...current, check: { status: "error", message, checkedAt: new Date().toISOString() } }
						: { loading: false, error: message }
				);
			}
		})();
		return () => controller.abort();
	}, [connectorId, messages.SCANNER_FORGE_CHECK_FAILED, messages.SCANNER_FORGE_LOAD_FAILED, runId]);

	return state;
}

export function formatElapsed(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function policySourceLabel(source: ScannerForgePolicySource): string {
	const messages = getMessage();
	return source.kind === "analyzer" && source.scannedAt
		? messages.SCANNER_FORGE_POLICY_SOURCE_ANALYZER(formatBrowserDateTime(source.scannedAt))
		: messages.SCANNER_FORGE_POLICY_SOURCE_MANUAL;
}

function rulesLabel(rulesRef?: string): string {
	const messages = getMessage();
	return rulesRef ? messages.SCANNER_FORGE_RULES_PINNED(rulesRef) : messages.SCANNER_FORGE_RULES_LATEST;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="min-w-0">
			<p className="text-[10px] font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">{label}</p>
			<div className="mt-1 text-xs text-stone-900 dark:text-stone-100">{children}</div>
		</div>
	);
}

function forgingFromRun(run: ScannerForgeRun): ScannerForgeInFlight {
	return {
		startedAt: Date.parse(run.startedAt),
		policies: run.policies,
		policySource: run.policySource,
		rulesRef: run.rulesRef,
		command: run.command || "",
	};
}

function ForgeRunning({ forging, onCancel }: { forging: ScannerForgeInFlight; onCancel?: () => void }) {
	const messages = getMessage();
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		const timer = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(timer);
	}, []);

	return (
		<div className="p-3">
			<section className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-950">
				<div className="flex items-start justify-between gap-3">
					<div className="flex min-w-0 items-start gap-3">
						<Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-blue-600 dark:text-blue-400" />
						<div className="min-w-0">
							<p className="text-sm font-semibold text-stone-950 dark:text-stone-50">
								{messages.SCANNER_FORGE_RUNNING_TITLE}
							</p>
							<p className="mt-0.5 text-xs text-muted-foreground">{messages.SCANNER_FORGE_RUNNING_BODY}</p>
						</div>
					</div>
					<div className="flex shrink-0 items-center gap-3">
						<span className="inline-flex items-center gap-1 font-mono text-xs tabular-nums text-stone-600 dark:text-stone-300">
							<Clock className="size-3.5" />
							{formatElapsed(now - forging.startedAt)}
						</span>
						{onCancel ? (
							<Button size="sm" variant="outline" className="h-8" onClick={onCancel}>
								{messages.CANCEL}
							</Button>
						) : null}
					</div>
				</div>
				<div className="mt-4 space-y-4 pl-7">
					<div className="grid gap-4 md:grid-cols-3">
						<Field label={messages.SCANNER_FORGE_POLICIES}>
							<div className="flex flex-wrap gap-1">
								{forging.policies.map((policy) => (
									<span
										key={policy}
										className="rounded border border-stone-200 px-1.5 py-0.5 font-mono text-[11px] dark:border-stone-700"
									>
										{policy}
									</span>
								))}
							</div>
						</Field>
						<Field label={messages.SCANNER_FORGE_POLICY_SOURCE}>
							<span className="inline-flex items-center gap-1">
								<History className="size-3.5 text-stone-500" />
								{policySourceLabel(forging.policySource)}
							</span>
						</Field>
						<Field label={messages.SCANNER_FORGE_RULES}>{rulesLabel(forging.rulesRef)}</Field>
					</div>
					{forging.command ? (
						<Field label={messages.SCANNER_FORGE_COMMAND}>
							<pre className="overflow-x-auto rounded-md border border-stone-200 bg-stone-50 px-3 py-2 font-mono text-xs dark:border-stone-800 dark:bg-stone-900">
								$ {forging.command}
							</pre>
						</Field>
					) : null}
				</div>
			</section>
		</div>
	);
}

function ForgeEmpty({ prefillPolicies, onRunForge }: { prefillPolicies: string[]; onRunForge: () => void }) {
	const messages = getMessage();
	return (
		<div className="flex min-h-0 flex-1 items-center justify-center p-6">
			<section className="flex max-w-md flex-col items-center rounded-lg border border-dashed border-stone-300 px-8 py-6 text-center dark:border-stone-700">
				<div className="flex size-9 items-center justify-center rounded-md border border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900/70 dark:bg-teal-950/40 dark:text-teal-300">
					<Hammer className="size-4" />
				</div>
				<p className="mt-3 text-sm font-semibold text-stone-950 dark:text-stone-50">
					{messages.SCANNER_FORGE_EMPTY_TITLE}
				</p>
				<p className="mt-1 text-xs leading-5 text-stone-500 dark:text-stone-400">{messages.SCANNER_FORGE_EMPTY_BODY}</p>
				<Button size="sm" className="mt-4 h-8 gap-1.5" onClick={onRunForge}>
					<Hammer className="size-3.5" />
					{messages.SCANNER_FORGE_RUN}
				</Button>
				<p className="mt-3 text-[11px] text-muted-foreground">
					{prefillPolicies.length
						? messages.SCANNER_FORGE_EMPTY_USES(prefillPolicies.join(", "))
						: messages.SCANNER_FORGE_EMPTY_NO_SCAN}
				</p>
			</section>
		</div>
	);
}

function ForgeError({
	title,
	message,
	runs,
	selectedRun,
	onSelectRun,
	onRunForge,
}: {
	title: string;
	message?: string;
	runs: ScannerForgeRun[];
	selectedRun?: ScannerForgeRun;
	onSelectRun: (id: string) => void;
	onRunForge: () => void;
}) {
	const messages = getMessage();
	return (
		<div className="space-y-3 p-3">
			{selectedRun ? (
				<div className="flex justify-end">
					<ScannerForgeRunPicker runs={runs} selectedRun={selectedRun} onSelectRun={onSelectRun} />
				</div>
			) : null}
			<div className="flex items-start justify-between gap-3 rounded-lg border border-error/30 bg-error/5 p-4 dark:bg-error/10">
				<div className="flex min-w-0 items-start gap-2">
					<AlertTriangle className="mt-0.5 size-4 shrink-0 text-error" />
					<div className="min-w-0">
						<p className="text-sm font-semibold text-error">{title}</p>
						{message ? (
							<p className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">{message}</p>
						) : null}
					</div>
				</div>
				<Button size="sm" className="h-8 shrink-0 gap-1.5" onClick={onRunForge}>
					<Hammer className="size-3.5" />
					{messages.SCANNER_FORGE_RUN}
				</Button>
			</div>
		</div>
	);
}

export default function ScannerForgePanel({
	runs,
	selectedRun,
	onSelectRun,
	forging,
	onCancel,
	prefillPolicies,
	onRunForge,
	onRegenerate,
	detail,
	check,
	loadingDetail,
	loadError,
}: {
	runs: ScannerForgeRun[];
	selectedRun?: ScannerForgeRun;
	onSelectRun: (id: string) => void;
	forging?: ScannerForgeInFlight;
	onCancel: () => void;
	prefillPolicies: string[];
	onRunForge: () => void;
	onRegenerate: (run: ScannerForgeRun) => void;
	detail?: ScannerForgeRun;
	check?: ScannerForgeCheck;
	loadingDetail: boolean;
	loadError?: string;
}) {
	const messages = getMessage();

	if (forging) return <ForgeRunning forging={forging} onCancel={onCancel} />;
	if (!runs.length || !selectedRun) {
		return <ForgeEmpty prefillPolicies={prefillPolicies} onRunForge={onRunForge} />;
	}
	// Started elsewhere, or still finishing after Cancel; the page refreshes until it settles.
	if (selectedRun.status === "running") return <ForgeRunning forging={forgingFromRun(selectedRun)} />;
	if (selectedRun.status === "failed" || selectedRun.status === "runtime-missing" || loadError) {
		return (
			<ForgeError
				title={loadError ? messages.SCANNER_FORGE_LOAD_FAILED : messages.SCANNER_FORGE_FAILED_TITLE}
				message={loadError || selectedRun.error}
				runs={runs}
				selectedRun={selectedRun}
				onSelectRun={onSelectRun}
				onRunForge={onRunForge}
			/>
		);
	}
	if (loadingDetail || detail?.id !== selectedRun.id) {
		return (
			<div className="space-y-3 p-3">
				<Skeleton className="h-10 w-full" />
				<Skeleton className="h-14 w-full" />
				<Skeleton className="h-72 w-full" />
			</div>
		);
	}
	return (
		<ScannerForgeSkillView
			run={selectedRun}
			detail={detail}
			check={check}
			runs={runs}
			onSelectRun={onSelectRun}
			onRegenerate={onRegenerate}
		/>
	);
}
