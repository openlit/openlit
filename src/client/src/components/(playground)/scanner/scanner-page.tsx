"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import { ChevronDown, Cable, ExternalLink, ListChecks, Play, RefreshCw, ScanSearch, Settings2 } from "lucide-react";
import { toast } from "sonner";
import FeatureAccess from "@/components/rbac/feature-access";
import FeaturePageHeader from "@/components/(playground)/feature-page-header";
import ScannerRuntimePanel from "@/components/(playground)/scanner/scanner-runtime-panel";
import ScannerFindingSheet from "@/components/(playground)/scanner/scanner-finding-sheet";
import ScannerRunParamsDialog, {
	EMPTY_SCANNER_RUN_DEFAULTS,
	type ScannerRunDefaults,
} from "@/components/(playground)/scanner/scanner-run-params-dialog";
import ScannerWorkspace from "@/components/(playground)/scanner/scanner-workspace";
import {
	SourceFormDialog,
	type TypeDescriptor,
} from "@/components/(playground)/telemetry-source/data-sources-page";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import getMessage from "@/constants/messages";
import DOCUMENTATION_LINKS from "@/constants/documentation-links";
import { getCurrentProject, getCurrentProjectEnvironment } from "@/selectors/project";
import { useRootStore } from "@/store";
import { getRequestHeaders } from "@/utils/api";
import { connectorIconPath } from "@/lib/platform/connectors/icons";
import type { ScannerFinding, ScannerJob, ScannerScanInput } from "@/lib/platform/connectors/scanner/types";

type ScannerConnector = {
	id: string;
	name: string;
	type: string;
	environment?: string;
	settings?: string;
	jobs?: ScannerJob[];
};

function parseSettings(settings?: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(settings || "{}");
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		/* keep empty */
	}
	return {};
}

function asBool(value: unknown, fallback = false): boolean {
	if (value === true || value === "true") return true;
	if (value === false || value === "false") return false;
	return fallback;
}

function connectorRunDefaults(settings?: string): ScannerRunDefaults {
	const parsed = parseSettings(settings);
	return {
		...EMPTY_SCANNER_RUN_DEFAULTS,
		target: String(parsed.target || ""),
		ref: String(parsed.ref || ""),
		detectors: String(parsed.detectors || ""),
		strict: asBool(parsed.strict),
		secretScan: asBool(parsed.secretScan),
		vulnScan: asBool(parsed.vulnScan),
		licenseScan: asBool(parsed.licenseScan),
		requireSigned: asBool(parsed.requireSigned, true),
		rulesRepo: String(parsed.rulesRepo || ""),
		rulesRef: String(parsed.rulesRef || ""),
		rulesSource: String(parsed.rulesSource || "environment"),
		noRulesUpdate: asBool(parsed.noRulesUpdate),
	};
}

function ConnectorMark({ type, size = 16 }: { type: string; size?: number }) {
	const src = connectorIconPath(type);
	if (!src) {
		return <ScanSearch className="shrink-0 text-stone-500" width={size} height={size} />;
	}
	return (
		<Image
			src={src}
			alt=""
			width={size}
			height={size}
			className="shrink-0 rounded-sm object-contain"
		/>
	);
}

export default function ScannerPage() {
	const messages = getMessage();
	const searchParams = useSearchParams();
	const queryConnectorId = searchParams.get("connectorId") || "";
	const queryJobId = searchParams.get("jobId") || "";
	const project = useRootStore(getCurrentProject);
	const environment = useRootStore(getCurrentProjectEnvironment) || "production";
	const [connectors, setConnectors] = useState<ScannerConnector[]>([]);
	const [connectorId, setConnectorId] = useState(queryConnectorId);
	const [loading, setLoading] = useState(true);
	const [running, setRunning] = useState(false);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [addOpen, setAddOpen] = useState(false);
	const [paramsOpen, setParamsOpen] = useState(false);
	const [jobId, setJobId] = useState(queryJobId);
	const [finding, setFinding] = useState<ScannerFinding | null>(null);
	const [descriptors, setDescriptors] = useState<TypeDescriptor[]>([]);

	const emptySteps = [
		{
			icon: Cable,
			title: messages.SCANNER_EMPTY_STEP_CONNECTOR,
			body: messages.SCANNER_EMPTY_STEP_CONNECTOR_BODY,
		},
		{
			icon: Settings2,
			title: messages.SCANNER_EMPTY_STEP_TARGET,
			body: messages.SCANNER_EMPTY_STEP_TARGET_BODY,
		},
		{
			icon: ListChecks,
			title: messages.SCANNER_EMPTY_STEP_RUN,
			body: messages.SCANNER_EMPTY_STEP_RUN_BODY,
		},
	];
	const emptyCaps = [
		messages.SCANNER_EMPTY_CAP_TYPES,
		messages.SCANNER_EMPTY_CAP_ENV,
		messages.SCANNER_EMPTY_CAP_OUTPUT,
	];

	const selected = useMemo(
		() => connectors.find((item) => item.id === connectorId) || connectors[0],
		[connectorId, connectors]
	);
	const jobs = selected?.jobs || [];
	const selectedJob = useMemo(
		() => jobs.find((job) => job.id === jobId) || jobs[0],
		[jobId, jobs]
	);
	const previousJob = useMemo(() => {
		if (!selectedJob) return undefined;
		const index = jobs.findIndex((job) => job.id === selectedJob.id);
		return index >= 0 ? jobs[index + 1] : undefined;
	}, [jobs, selectedJob]);
	const runDefaults = useMemo(
		() => connectorRunDefaults(selected?.settings),
		[selected?.settings]
	);

	const load = useCallback(async () => {
		if (!project?.id) {
			return;
		}
		setLoading(true);
		setLoadError(null);
		try {
			const [scannerRes, typeRes] = await Promise.all([
				fetch("/api/scanners", { headers: getRequestHeaders() }),
				fetch("/api/connectors/types", { headers: getRequestHeaders() }),
			]);
			if (!scannerRes.ok) throw new Error(messages.SCANNER_LOAD_FAILED);
			const scannerBody = await scannerRes.json();
			const typeBody = typeRes.ok ? await typeRes.json() : { types: [] };
			const next: ScannerConnector[] = scannerBody.connectors || [];
			setConnectors(next);
			setDescriptors(
				((typeBody.types || []) as TypeDescriptor[]).filter((item) => item.category === "scanner")
			);
			const preferredId = connectorId || queryConnectorId;
			const resolvedId = next.some((item) => item.id === preferredId)
				? preferredId
				: next[0]?.id || "";
			setConnectorId(resolvedId);
			const nextJobs = next.find((item) => item.id === resolvedId)?.jobs || [];
			setJobId((current) => {
				const preferredJob = current || queryJobId;
				return nextJobs.some((job) => job.id === preferredJob)
					? preferredJob
					: nextJobs[0]?.id || "";
			});
		} catch (error) {
			setLoadError(error instanceof Error ? error.message : messages.SCANNER_LOAD_FAILED);
		} finally {
			setLoading(false);
		}
	}, [connectorId, messages.SCANNER_LOAD_FAILED, project?.id, queryConnectorId, queryJobId]);

	useEffect(() => {
		void load();
	}, [load, environment, project?.id]);

	const runScan = async (input: ScannerScanInput = {}) => {
		if (!selected?.id) return;
		setRunning(true);
		setParamsOpen(false);
		toast.loading(messages.SCANNER_RUN, { id: "scanner-run" });
		try {
			const response = await fetch(`/api/scanners/${encodeURIComponent(selected.id)}/scan`, {
				method: "POST",
				headers: getRequestHeaders({ "Content-Type": "application/json" }),
				body: JSON.stringify(input),
			});
			const body = await response.json();
			if (!response.ok) throw new Error(body?.err || messages.SCANNER_SCAN_FAILED);
			if (typeof body?.job?.id === "string") setJobId(body.job.id);
			toast.success(messages.SCANNER_RUN, { id: "scanner-run" });
			await load();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : messages.SCANNER_SCAN_FAILED, {
				id: "scanner-run",
			});
		} finally {
			setRunning(false);
		}
	};

	return (
		<div className="flex h-full min-h-0 w-full flex-col overflow-hidden text-stone-700 dark:text-stone-300">
			<FeaturePageHeader
				eyebrow={messages.SIDEBAR_DEVELOP}
				title={messages.FEATURE_SCANNER}
				icon={<ScanSearch className="h-4 w-4" />}
				tone="border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900/70 dark:bg-teal-950/40 dark:text-teal-300"
				actions={
					<div className="flex items-center gap-1.5">
						<FeatureAccess access="connectors.create" hideWhenDenied>
							<Button
								size="sm"
								variant="outline"
								className="h-8 gap-1.5"
								onClick={() => setAddOpen(true)}
								disabled={!project?.id}
							>
								<Cable className="size-3.5" />
								{messages.ADD_CONNECTOR}
							</Button>
						</FeatureAccess>
						<FeatureAccess access="scanner.scan" hideWhenDenied>
							<div className="flex">
								<Button
									size="sm"
									className="h-8 gap-1.5 rounded-r-none"
									onClick={() => void runScan()}
									disabled={loading || running || !selected?.id}
								>
									<Play className="size-3.5" />
									{messages.SCANNER_RUN}
								</Button>
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button
											size="sm"
											className="h-8 rounded-l-none border-l border-stone-700 px-2 dark:border-stone-300"
											disabled={loading || running || !selected?.id}
											aria-label={messages.SCANNER_RUN_MENU}
										>
											<ChevronDown className="size-3.5" />
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end" className="w-56">
										<DropdownMenuItem onSelect={() => void runScan()}>
											{messages.SCANNER_RUN_DEFAULTS}
										</DropdownMenuItem>
										<DropdownMenuItem onSelect={() => setParamsOpen(true)}>
											{messages.SCANNER_RUN_PARAMS}
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							</div>
						</FeatureAccess>
						<Button
							size="sm"
							variant="outline"
							className="h-8 gap-1.5"
							onClick={() => void load()}
							disabled={loading || !project?.id}
						>
							<RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
							{messages.SCANNER_REFRESH}
						</Button>
					</div>
				}
			/>

			<FeatureAccess access="scanner.read" requireProject>
				<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
					{connectors.length > 0 ? (
						<div className="flex flex-wrap items-center gap-2 border-b border-stone-200 px-4 py-2 dark:border-stone-800">
							<label className="text-xs text-muted-foreground">{messages.SCANNER_CONNECTOR_LABEL}</label>
							<Select
								value={selected?.id || ""}
								onValueChange={(next) => {
									setConnectorId(next);
									const nextJobs = connectors.find((item) => item.id === next)?.jobs || [];
									setJobId(nextJobs[0]?.id || "");
									setFinding(null);
								}}
								disabled={loading}
							>
								<SelectTrigger className="h-8 w-[280px] bg-white text-xs dark:bg-stone-950">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{connectors.map((connector) => (
										<SelectItem key={connector.id} value={connector.id}>
											<span className="flex items-center gap-2">
												<ConnectorMark type={connector.type} size={14} />
												{connector.name}
											</span>
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							{selected?.type === "trustabl" ? (
								<div className="ml-auto">
									<ScannerRuntimePanel compact />
								</div>
							) : null}
						</div>
					) : null}

					{loadError ? (
						<div className="m-4 rounded-lg border border-error/30 bg-error/5 p-4 dark:bg-error/10">
							<p className="text-sm font-semibold text-error">{messages.SCANNER_LOAD_FAILED}</p>
							<p className="mt-1 text-xs text-muted-foreground">{loadError}</p>
						</div>
					) : null}

					{loading || !project?.id ? (
						<div className="space-y-3 p-4">
							<Skeleton className="h-16 w-full" />
							<Skeleton className="h-48 w-full" />
						</div>
					) : !connectors.length ? (
						<div className="flex min-h-0 flex-1 flex-col overflow-auto">
							<div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4">
								<section className="rounded-lg border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-950">
									<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
										<div className="flex min-w-0 items-start gap-3">
											<div className="flex size-11 shrink-0 items-center justify-center rounded-md border border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900/70 dark:bg-teal-950/40 dark:text-teal-300">
												<ScanSearch className="h-5 w-5" />
											</div>
											<div className="min-w-0">
												<p className="text-sm font-semibold text-stone-950 dark:text-stone-50">
													{messages.SCANNER_EMPTY_TITLE}
												</p>
												<p className="mt-1 max-w-xl text-xs leading-5 text-stone-500 dark:text-stone-400">
													{messages.SCANNER_EMPTY_CONNECTORS}
												</p>
												<div className="mt-3 flex flex-wrap gap-1.5">
													{emptyCaps.map((cap) => (
														<Badge key={cap} variant="secondary" className="text-[10px] font-normal">
															{cap}
														</Badge>
													))}
												</div>
											</div>
										</div>
										<div className="flex shrink-0 flex-wrap items-center gap-2">
											<FeatureAccess access="connectors.create" hideWhenDenied>
												<Button size="sm" className="h-8 gap-1.5" onClick={() => setAddOpen(true)}>
													<Cable className="size-3.5" />
													{messages.SCANNER_EMPTY_CONNECTORS_ACTION}
												</Button>
											</FeatureAccess>
											<a
												href={DOCUMENTATION_LINKS.scannerConnectors}
												target="_blank"
												rel="noreferrer noopener"
												className="inline-flex h-8 items-center gap-1.5 rounded-md border border-stone-200 px-2.5 text-xs font-medium text-stone-700 hover:bg-stone-50 dark:border-stone-800 dark:text-stone-300 dark:hover:bg-stone-900"
											>
												<ExternalLink className="size-3.5" />
												{messages.SCANNER_EMPTY_DOCS}
											</a>
										</div>
									</div>
								</section>

								<section>
									<h2 className="mb-2 text-sm font-semibold text-stone-950 dark:text-stone-50">
										{messages.SCANNER_EMPTY_HOW}
									</h2>
									<div className="grid gap-3 md:grid-cols-3">
										{emptySteps.map((step, index) => {
											const Icon = step.icon;
											return (
												<div
													key={step.title}
													className="rounded-md border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-950"
												>
													<div className="flex items-center gap-2">
														<span className="inline-flex size-6 items-center justify-center rounded border border-stone-200 text-[11px] font-semibold tabular-nums text-stone-600 dark:border-stone-700 dark:text-stone-300">
															{index + 1}
														</span>
														<Icon className="size-3.5 text-teal-700 dark:text-teal-300" />
														<p className="text-xs font-semibold text-stone-950 dark:text-stone-50">{step.title}</p>
													</div>
													<p className="mt-2 text-xs leading-5 text-stone-500 dark:text-stone-400">{step.body}</p>
												</div>
											);
										})}
									</div>
								</section>

								<section>
									<h2 className="mb-2 text-sm font-semibold text-stone-950 dark:text-stone-50">
										{messages.SCANNER_EMPTY_PREVIEW}
									</h2>
									<div className="grid gap-3 md:grid-cols-2">
										<div className="rounded-md border border-dashed border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-950">
											<p className="text-xs font-semibold text-stone-950 dark:text-stone-50">{messages.SCANNER_JOBS}</p>
											<div className="mt-2 space-y-1.5">
												<div className="h-7 rounded border border-stone-100 bg-stone-50 dark:border-stone-800 dark:bg-stone-900" />
												<div className="h-7 rounded border border-stone-100 bg-stone-50 dark:border-stone-800 dark:bg-stone-900" />
											</div>
											<p className="mt-2 text-[11px] text-muted-foreground">{messages.SCANNER_EMPTY_JOBS}</p>
										</div>
										<div className="rounded-md border border-dashed border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-950">
											<p className="text-xs font-semibold text-stone-950 dark:text-stone-50">{messages.SCANNER_FINDINGS}</p>
											<div className="mt-2 space-y-1.5">
												<div className="h-7 rounded border border-stone-100 bg-stone-50 dark:border-stone-800 dark:bg-stone-900" />
												<div className="h-7 rounded border border-stone-100 bg-stone-50 dark:border-stone-800 dark:bg-stone-900" />
												<div className="h-7 rounded border border-stone-100 bg-stone-50 dark:border-stone-800 dark:bg-stone-900" />
											</div>
											<p className="mt-2 text-[11px] text-muted-foreground">{messages.SCANNER_EMPTY_FINDINGS}</p>
										</div>
									</div>
								</section>
							</div>
						</div>
					) : (
						<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
							<ScannerWorkspace
								jobs={jobs}
								selectedJob={selectedJob}
								previousJob={previousJob}
								onSelectJob={(next) => {
									setJobId(next);
									setFinding(null);
								}}
								onOpenFinding={setFinding}
							/>
						</div>
					)}
				</div>
			</FeatureAccess>

			{paramsOpen ? (
				<ScannerRunParamsDialog
					open={paramsOpen}
					defaults={runDefaults}
					onClose={() => setParamsOpen(false)}
					onRun={(input) => void runScan(input)}
				/>
			) : null}
			<ScannerFindingSheet
				open={Boolean(finding)}
				finding={finding}
				job={selectedJob}
				onClose={() => setFinding(null)}
			/>
			{addOpen ? (
				<SourceFormDialog
					source={null}
					descriptors={descriptors}
					initialType={descriptors[0]?.type}
					initialEnvironment={environment}
					onClose={() => setAddOpen(false)}
					onSaved={() => {
						setAddOpen(false);
						void load();
					}}
				/>
			) : null}
		</div>
	);
}
