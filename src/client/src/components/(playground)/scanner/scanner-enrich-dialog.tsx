"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import getMessage from "@/constants/messages";
import { getRequestHeaders } from "@/utils/api";
import type {
	ScannerEnrichParams,
	ScannerEnrichProvider,
	ScannerFinding,
	ScannerJob,
} from "@/lib/platform/connectors/scanner/types";

type ProviderInfo = {
	id: ScannerEnrichProvider;
	label: string;
	envKey: string;
	hasKey: boolean;
	models: string[];
};

const DEFAULT_MODEL = "__trustabl_default__";
const ATTEMPT_OPTIONS = [1, 2];

function repoLabel(target: string): string {
	return target.replace(/^https?:\/\/(www\.)?github\.com\//, "").replace(/\.git$/, "");
}

function findingLocation(finding: ScannerFinding): string {
	if (!finding.line) return finding.path || "";
	const end = finding.endLine && finding.endLine !== finding.line ? `-${finding.endLine}` : "";
	return `${finding.path}:${finding.line}${end}`;
}

export default function ScannerEnrichDialog({
	open,
	connectorId,
	finding,
	alertNumber,
	job,
	onClose,
	onEnrich,
}: {
	open: boolean;
	connectorId: string;
	finding: ScannerFinding;
	alertNumber: number;
	job?: ScannerJob | null;
	onClose: () => void;
	onEnrich: (params: ScannerEnrichParams) => void;
}) {
	const messages = getMessage();
	const [providers, setProviders] = useState<ProviderInfo[] | null>(null);
	const [loadError, setLoadError] = useState(false);
	const [provider, setProvider] = useState<ScannerEnrichProvider>("anthropic");
	const [model, setModel] = useState(DEFAULT_MODEL);
	const [attempts, setAttempts] = useState(1);
	const [recheck, setRecheck] = useState(true);
	const [baseRef, setBaseRef] = useState(job?.ref || "");

	useEffect(() => {
		if (!open) return;
		setModel(DEFAULT_MODEL);
		setAttempts(1);
		setRecheck(true);
		setBaseRef(job?.ref || "");
	}, [job?.ref, open]);

	useEffect(() => {
		if (!open) return;
		const controller = new AbortController();
		setProviders(null);
		setLoadError(false);
		fetch(`/api/scanners/${encodeURIComponent(connectorId)}/enrich/providers`, {
			headers: getRequestHeaders(),
			signal: controller.signal,
		})
			.then(async (response) => {
				const body = await response.json();
				if (!response.ok) throw new Error(body?.err || messages.SCANNER_ENRICH_PROVIDERS_FAILED);
				if (controller.signal.aborted) return;
				const list: ProviderInfo[] = body.providers || [];
				setProviders(list);
				setProvider((list.find((item) => item.hasKey) || list[0])?.id || "anthropic");
			})
			.catch(() => {
				if (controller.signal.aborted) return;
				setProviders([]);
				setLoadError(true);
			});
		return () => controller.abort();
	}, [connectorId, messages.SCANNER_ENRICH_PROVIDERS_FAILED, open]);

	const selected = providers?.find((item) => item.id === provider);
	const others = useMemo(
		() =>
			(job?.findings || [])
				.map((item, index) => ({ item, number: index + 1 }))
				.filter(({ item, number }) => item.ruleId === finding.ruleId && number !== alertNumber)
				.map(({ number }) => number),
		[alertNumber, finding.ruleId, job?.findings]
	);
	const canEnrich = Boolean(selected?.hasKey);

	const submit = () => {
		if (!canEnrich) return;
		onEnrich({
			provider,
			model: model === DEFAULT_MODEL ? undefined : model,
			attempts,
			recheck,
			baseRef: baseRef.trim() || undefined,
		});
	};

	return (
		<Dialog open={open} onOpenChange={(next) => !next && onClose()}>
			<DialogContent className="flex w-[calc(100vw-2rem)] max-h-[90vh] max-w-3xl flex-col gap-0 overflow-hidden border-stone-200 bg-white p-0 text-stone-950 shadow-2xl dark:border-stone-800 dark:bg-stone-950 dark:text-stone-50 sm:max-w-3xl">
				<form
					className="flex min-h-0 flex-1 flex-col"
					onSubmit={(event) => {
						event.preventDefault();
						submit();
					}}
				>
					<DialogHeader className="shrink-0 space-y-1 border-b border-stone-200 px-6 py-4 pr-12 dark:border-stone-800">
						<DialogTitle>{messages.SCANNER_ENRICH_DIALOG_TITLE}</DialogTitle>
						<DialogDescription>
							{messages.SCANNER_ENRICH_DIALOG_DESCRIPTION(repoLabel(job?.target || ""))}
						</DialogDescription>
					</DialogHeader>

					<div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
						<div className="flex items-start gap-3 rounded-md border border-stone-200 px-3 py-2.5 dark:border-stone-800">
							<span className="mt-0.5 rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-800 dark:bg-orange-900/40 dark:text-orange-300">
								{finding.severity}
							</span>
							<div className="min-w-0">
								<p className="text-xs font-semibold">
									{messages.SCANNER_FINDING_NUMBER(alertNumber)} {finding.title}
								</p>
								<p className="mt-0.5 break-all font-mono text-[11px] text-stone-500 dark:text-stone-400">
									{[finding.ruleId, findingLocation(finding)].filter(Boolean).join(" · ")}
								</p>
							</div>
						</div>

						<Section title={messages.SCANNER_ENRICH_SECTION_PROVIDER}>
							<div className="grid gap-3 sm:grid-cols-2">
								<Field id="scanner-enrich-provider" label={messages.SCANNER_ENRICH_PROVIDER}>
									<Select
										value={provider}
										onValueChange={(next) => {
											setProvider(next as ScannerEnrichProvider);
											setModel(DEFAULT_MODEL);
										}}
									>
										<SelectTrigger id="scanner-enrich-provider" className="h-8 bg-white dark:bg-stone-900">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{(providers || []).map((item) => (
												<SelectItem key={item.id} value={item.id}>
													{item.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
									<KeyStatus providers={providers} loadError={loadError} selected={selected} />
								</Field>
								<Field id="scanner-enrich-model" label={messages.SCANNER_ENRICH_MODEL}>
									<Select value={model} onValueChange={setModel}>
										<SelectTrigger id="scanner-enrich-model" className="h-8 bg-white dark:bg-stone-900">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value={DEFAULT_MODEL}>{messages.SCANNER_ENRICH_MODEL_DEFAULT}</SelectItem>
											{(selected?.models || []).map((item) => (
												<SelectItem key={item} value={item}>
													{item}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
									<Hint>
										{model === DEFAULT_MODEL
											? messages.SCANNER_ENRICH_MODEL_DEFAULT_HINT
											: messages.SCANNER_ENRICH_MODEL_HINT}
									</Hint>
								</Field>
							</div>
						</Section>

						<Section title={messages.SCANNER_ENRICH_SECTION_RUN}>
							<div className="grid gap-3 sm:grid-cols-2">
								<Field id="scanner-enrich-scope" label={messages.SCANNER_ENRICH_SCOPE}>
									<Input
										id="scanner-enrich-scope"
										value={messages.SCANNER_ENRICH_SCOPE_VALUE(alertNumber)}
										readOnly
										className="h-8 bg-stone-50 dark:bg-stone-900"
									/>
									<Hint>
										{others.length
											? messages.SCANNER_ENRICH_SCOPE_OTHERS(
													finding.ruleId,
													others.map((item) => `#${item}`).join(", ")
												)
											: messages.SCANNER_ENRICH_SCOPE_ONLY(finding.ruleId)}
									</Hint>
								</Field>
								<Field id="scanner-enrich-attempts" label={messages.SCANNER_ENRICH_ATTEMPTS}>
									<Select value={String(attempts)} onValueChange={(next) => setAttempts(Number(next))}>
										<SelectTrigger id="scanner-enrich-attempts" className="h-8 bg-white dark:bg-stone-900">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{ATTEMPT_OPTIONS.map((item) => (
												<SelectItem key={item} value={String(item)}>
													{messages.SCANNER_ENRICH_ATTEMPTS_OPTION(item)}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
									<Hint>{messages.SCANNER_ENRICH_ATTEMPTS_HINT(finding.ruleId)}</Hint>
								</Field>
							</div>
							<div className="flex flex-col gap-1.5 rounded-md border border-stone-200 px-3 py-2.5 dark:border-stone-800">
								<div className="flex items-center justify-between gap-3">
									<Label htmlFor="scanner-enrich-recheck" className="text-xs font-medium">
										{messages.SCANNER_ENRICH_RECHECK}
									</Label>
									<Switch id="scanner-enrich-recheck" checked={recheck} onCheckedChange={setRecheck} />
								</div>
								<Hint>{messages.SCANNER_ENRICH_RECHECK_HINT(alertNumber)}</Hint>
							</div>
						</Section>

						<Section title={messages.SCANNER_ENRICH_SECTION_GIT}>
							<div className="grid gap-3 sm:grid-cols-2">
								<Field id="scanner-enrich-base-ref" label={messages.SCANNER_ENRICH_BASE_BRANCH}>
									<Input
										id="scanner-enrich-base-ref"
										value={baseRef}
										autoComplete="off"
										onChange={(event) => setBaseRef(event.target.value)}
										className="h-8 bg-white dark:bg-stone-900"
									/>
									<Hint>{messages.SCANNER_ENRICH_BASE_BRANCH_HINT}</Hint>
								</Field>
							</div>
						</Section>

						<Section title={messages.SCANNER_ENRICH_SECTION_COMMAND}>
							<pre className="overflow-x-auto rounded-md border border-stone-200 bg-stone-50 px-3 py-2 font-mono text-[11px] text-stone-800 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200">
								{messages.SCANNER_ENRICH_COMMAND_PREVIEW(alertNumber)}
							</pre>
							<Hint>{messages.SCANNER_ENRICH_EGRESS_NOTE}</Hint>
						</Section>
					</div>

					<DialogFooter className="shrink-0 gap-2 border-t border-stone-200 px-6 py-3 sm:justify-end dark:border-stone-800">
						<Button type="button" variant="outline" size="sm" className="h-8" onClick={onClose}>
							{messages.CANCEL}
						</Button>
						<Button type="submit" size="sm" className="h-8 gap-1.5" disabled={!canEnrich}>
							<Sparkles className="h-3.5 w-3.5" />
							{messages.SCANNER_ENRICH}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function KeyStatus({
	providers,
	loadError,
	selected,
}: {
	providers: ProviderInfo[] | null;
	loadError: boolean;
	selected?: ProviderInfo;
}) {
	const messages = getMessage();
	if (!providers) {
		return (
			<p className="flex items-center gap-1 text-[11px] text-stone-500 dark:text-stone-400">
				<Loader2 className="h-3.5 w-3.5 animate-spin" />
				{messages.SCANNER_ENRICH_PROVIDERS_LOADING}
			</p>
		);
	}
	if (loadError || !selected) {
		return (
			<p className="flex items-center gap-1 text-[11px] text-rose-700 dark:text-rose-400">
				<AlertCircle className="h-3.5 w-3.5" />
				{messages.SCANNER_ENRICH_PROVIDERS_FAILED}
			</p>
		);
	}
	if (selected.hasKey) {
		return (
			<p className="flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400">
				<CheckCircle2 className="h-3.5 w-3.5" />
				{messages.SCANNER_ENRICH_KEY_FROM_VAULT(selected.envKey)}
			</p>
		);
	}
	return (
		<p className="flex flex-wrap items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400">
			<AlertCircle className="h-3.5 w-3.5" />
			<span>{messages.SCANNER_ENRICH_KEY_NOT_IN_VAULT(selected.envKey)}</span>
			<span aria-hidden>·</span>
			<a href="/vault" className="underline underline-offset-2">
				{messages.SCANNER_ENRICH_ADD_KEY}
			</a>
		</p>
	);
}

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="space-y-2.5">
			<p className="text-[10px] font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
				{title}
			</p>
			{children}
		</section>
	);
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
	return (
		<div className="space-y-1.5">
			<Label htmlFor={id} className="text-xs">
				{label}
			</Label>
			{children}
		</div>
	);
}

function Hint({ children }: { children: ReactNode }) {
	return <p className="text-[11px] leading-4 text-stone-500 dark:text-stone-400">{children}</p>;
}
