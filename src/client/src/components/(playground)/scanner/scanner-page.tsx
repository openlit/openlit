"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import {
	ChevronDown,
	Cable,
	ExternalLink,
	FileCode2,
	GitBranch,
	Hammer,
	ListChecks,
	Play,
	RefreshCw,
	ScanSearch,
	Settings2,
	ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import FeatureAccess from "@/components/rbac/feature-access";
import FeaturePageHeader from "@/components/(playground)/feature-page-header";
import ScannerRuntimePanel from "@/components/(playground)/scanner/scanner-runtime-panel";
import ScannerFindingSheet from "@/components/(playground)/scanner/scanner-finding-sheet";
import ScannerForgePanel, {
	useScannerForgeRun,
	type ScannerForgeInFlight,
} from "@/components/(playground)/scanner/scanner-forge-panel";
import ScannerForgeParamsDialog, {
	type ScannerForgeDefaults,
} from "@/components/(playground)/scanner/scanner-forge-params-dialog";
import { ScannerForgeStatusBadge } from "@/components/(playground)/scanner/scanner-forge-skill-view";
import ScannerRunParamsDialog, {
	emptyScannerRunDefaults,
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
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import getMessage from "@/constants/messages";
import DOCUMENTATION_LINKS from "@/constants/documentation-links";
import { getCurrentProject, getCurrentProjectEnvironment } from "@/selectors/project";
import { useRootStore } from "@/store";
import { getRequestHeaders } from "@/utils/api";
import { connectorIconPath } from "@/lib/platform/connectors/icons";
import { trustablRunParamFields } from "@/lib/platform/connectors/scanner/config-fields";
import type { ScannerCliSchema, ScannerForgeSchema } from "@/lib/platform/connectors/scanner/cli-schema";
import {
	buildScannerForgeArgv,
	FORGE_DEFAULT_FILE_NAME,
	forgeCommandPreview,
} from "@/lib/platform/connectors/scanner/forge-params";
import {
	FALLBACK_FORGE_POLICIES,
	forgePoliciesFromJob,
	latestAnalyzerJobForRepo,
} from "@/lib/platform/connectors/scanner/forge-policies";
import { groupScannerJobsByRepo, scannerJobRepoKey } from "@/lib/platform/connectors/scanner/job-repos";
import { scannerRepoKey } from "@/lib/platform/connectors/scanner/target";
import type {
	ScannerCapabilities,
	ScannerFinding,
	ScannerForgeRun,
	ScannerForgeRunInput,
	ScannerJob,
	ScannerScanInput,
	ScannerRuntimeInfo,
} from "@/lib/platform/connectors/scanner/types";

type ScannerView = "analyzer" | "forge";

/** How often to re-read a forge run that is still going on the server. */
const FORGE_REFRESH_MS = 3000;

type ScannerConnector = {
	id: string;
	name: string;
	type: string;
	environment?: string;
	settings?: string;
	jobs?: ScannerJob[];
	forgeRuns?: ScannerForgeRun[];
	capabilities?: ScannerCapabilities;
};

function forgeRunTargets(connector?: ScannerConnector): string[] {
	return (connector?.forgeRuns || []).map((run) => run.target);
}

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

function connectorRunDefaults(
	settings?: string,
	fields = trustablRunParamFields()
): ScannerRunDefaults {
	const parsed = parseSettings(settings);
	const next = emptyScannerRunDefaults(fields);
	for (const field of fields) {
		const raw = parsed[field.key];
		if (raw == null) continue;
		if (field.kind === "switch") next[field.key] = asBool(raw, Boolean(field.defaultValue));
		else next[field.key] = String(raw);
	}
	return next;
}

const scannerTabClass =
	"h-9 gap-1.5 rounded-none border-b-2 border-transparent bg-transparent px-2.5 text-xs shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-stone-900 data-[state=active]:shadow-none dark:data-[state=active]:text-stone-50";

const toolbarSelectTriggerClass =
	"h-9 w-fit max-w-[20rem] shrink-0 gap-2 bg-white px-2 text-left text-xs dark:bg-stone-950 [&>span]:line-clamp-none [&>span]:flex [&>span]:w-max [&>span]:max-w-full [&>svg]:ml-0 [&>svg]:size-3.5 [&>svg]:shrink-0";

function ToolbarSelectValue({
	icon,
	label,
	value,
}: {
	icon: ReactNode;
	label: string;
	value?: string;
}) {
	return (
		<span className="flex w-max max-w-full items-center gap-2">
			{icon}
			<span className="min-w-0 max-w-full text-left leading-tight">
				<span className="block text-[10px] font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">
					{label}
				</span>
				<span className="block max-w-[16rem] truncate font-medium text-stone-900 dark:text-stone-100">
					{value || "—"}
				</span>
			</span>
		</span>
	);
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
	const [repoKey, setRepoKey] = useState("");
	const [finding, setFinding] = useState<ScannerFinding | null>(null);
	const [alertNumber, setAlertNumber] = useState<number | undefined>();
	const [descriptors, setDescriptors] = useState<TypeDescriptor[]>([]);
	const [cliSchema, setCliSchema] = useState<ScannerCliSchema | undefined>();
	const [forgeSchema, setForgeSchema] = useState<ScannerForgeSchema | undefined>();
	const [view, setView] = useState<ScannerView>("analyzer");
	const [forgeParamsOpen, setForgeParamsOpen] = useState(false);
	const [forging, setForging] = useState<ScannerForgeInFlight | undefined>();
	const [forgeRunId, setForgeRunId] = useState("");
	const forgeAbortRef = useRef<AbortController | null>(null);
	const jobIdRef = useRef(jobId);
	jobIdRef.current = jobId;
	const repoKeyRef = useRef(repoKey);
	repoKeyRef.current = repoKey;
	const handleRuntimeChange = useCallback((runtime: ScannerRuntimeInfo | null) => {
		setCliSchema(runtime?.schema);
		setForgeSchema(runtime?.forge);
	}, []);

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
	const defaultTarget = useMemo(() => {
		const target = parseSettings(selected?.settings).target;
		return typeof target === "string" ? target : "";
	}, [selected?.settings]);
	const forgeRuns = useMemo(() => selected?.forgeRuns || [], [selected?.forgeRuns]);
	const forgeEnabled = Boolean(selected?.capabilities?.forge);
	const repoGroups = useMemo(
		() => groupScannerJobsByRepo(jobs, defaultTarget, forgeRuns.map((run) => run.target)),
		[defaultTarget, forgeRuns, jobs]
	);
	const selectedRepo = useMemo(
		() => repoGroups.find((group) => group.repoKey === repoKey) || repoGroups[0],
		[repoGroups, repoKey]
	);
	const repoJobs = selectedRepo?.jobs || [];
	const selectedJob = useMemo(
		() => repoJobs.find((job) => job.id === jobId) || repoJobs[0],
		[jobId, repoJobs]
	);
	const previousJob = useMemo(() => {
		if (!selectedJob) return undefined;
		const index = repoJobs.findIndex((job) => job.id === selectedJob.id);
		return index >= 0 ? repoJobs[index + 1] : undefined;
	}, [repoJobs, selectedJob]);
	const repoForgeRuns = useMemo(
		() =>
			selectedRepo
				? forgeRuns.filter((run) => (scannerRepoKey(run.target) || run.target) === selectedRepo.repoKey)
				: [],
		[forgeRuns, selectedRepo]
	);
	const selectedForgeRun = useMemo(
		() => repoForgeRuns.find((run) => run.id === forgeRunId) || repoForgeRuns[0],
		[forgeRunId, repoForgeRuns]
	);
	const forgeRun = useScannerForgeRun(selected?.id, selectedForgeRun);
	const forgePrefill = useMemo(() => {
		const job = selectedRepo?.target ? latestAnalyzerJobForRepo(jobs, selectedRepo.target) : undefined;
		const accepted = forgeSchema?.policies.length ? forgeSchema.policies : FALLBACK_FORGE_POLICIES;
		const policies = forgePoliciesFromJob(job, accepted);
		return job && policies.length ? { job, policies } : undefined;
	}, [forgeSchema, jobs, selectedRepo?.target]);
	const forgeDefaults = useMemo<ScannerForgeDefaults>(
		() => ({
			target: selectedRepo?.target || defaultTarget,
			fileName: FORGE_DEFAULT_FILE_NAME,
			rulesRef: "",
			policies: forgePrefill?.policies || [],
			extras: {},
		}),
		[defaultTarget, forgePrefill?.policies, selectedRepo?.target]
	);
	const forgeStatus = forging || selectedForgeRun?.status === "running"
		? "running"
		: selectedForgeRun && selectedForgeRun.status !== "succeeded"
			? "failed"
			: forgeRun.check?.status === "stale"
				? "stale"
				: forgeRun.check?.status === "current"
					? "current"
					: undefined;
	const runDefaults = useMemo(() => {
		const next = connectorRunDefaults(selected?.settings, trustablRunParamFields(cliSchema));
		if (selectedRepo?.target) next.target = selectedRepo.target;
		return next;
	}, [cliSchema, selected?.settings, selectedRepo?.target]);

	// Quiet reloads keep the current view on screen instead of the page skeleton.
	const load = useCallback(async ({ quiet = false }: { quiet?: boolean } = {}) => {
		if (!project?.id) {
			return;
		}
		if (!quiet) setLoading(true);
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
			const resolved = next.find((item) => item.id === resolvedId);
			const nextJobs = resolved?.jobs || [];
			const nextDefault =
				typeof parseSettings(resolved?.settings).target === "string"
					? String(parseSettings(resolved?.settings).target)
					: "";
			const groups = groupScannerJobsByRepo(nextJobs, nextDefault, forgeRunTargets(resolved));
			const preferredJob = jobIdRef.current || queryJobId;
			const matchedJob = nextJobs.find((job) => job.id === preferredJob);
			const repo =
				groups.find((group) => group.repoKey === repoKeyRef.current) ||
				groups.find((group) => matchedJob && group.repoKey === scannerJobRepoKey(matchedJob)) ||
				groups[0];
			const resolvedJob = repo?.jobs.find((job) => job.id === preferredJob) || repo?.jobs[0];
			setJobId(resolvedJob?.id || "");
			setRepoKey(repo?.repoKey || "");
		} catch (error) {
			setLoadError(error instanceof Error ? error.message : messages.SCANNER_LOAD_FAILED);
		} finally {
			if (!quiet) setLoading(false);
		}
	}, [connectorId, messages.SCANNER_LOAD_FAILED, project?.id, queryConnectorId, queryJobId]);

	useEffect(() => {
		void load();
	}, [load, environment, project?.id]);

	const forgeRunPending = !forging && selectedForgeRun?.status === "running";
	useEffect(() => {
		if (!forgeRunPending) return;
		const timer = window.setTimeout(() => void load({ quiet: true }), FORGE_REFRESH_MS);
		return () => window.clearTimeout(timer);
	}, [forgeRunPending, load, connectors]);

	const runScan = async (input: ScannerScanInput = {}) => {
		if (!selected?.id) return;
		setRunning(true);
		setParamsOpen(false);
		toast.loading(messages.SCANNER_RUN, { id: "scanner-run" });
		try {
			const payload: ScannerScanInput = { ...input };
			if (!payload.target && selectedRepo?.target) {
				payload.target = selectedRepo.target;
			}
			const response = await fetch(`/api/scanners/${encodeURIComponent(selected.id)}/scan`, {
				method: "POST",
				headers: getRequestHeaders({ "Content-Type": "application/json" }),
				body: JSON.stringify(payload),
			});
			const body = await response.json();
			if (!response.ok) throw new Error(body?.err || messages.SCANNER_SCAN_FAILED);
			if (typeof body?.job?.id === "string") {
				setJobId(body.job.id);
				if (typeof body.job.target === "string" && body.job.target) {
					setRepoKey(scannerJobRepoKey(body.job as ScannerJob));
				}
			}
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

	const runForge = async (input: ScannerForgeRunInput = {}) => {
		if (!selected?.id || forging) return;
		const payload: ScannerForgeRunInput = { ...input };
		if (!payload.target && selectedRepo?.target) payload.target = selectedRepo.target;
		if (!payload.policies?.length) {
			if (!forgePrefill) {
				setForgeParamsOpen(true);
				return;
			}
			payload.policies = forgePrefill.policies;
			payload.sourceJobId = forgePrefill.job.id;
		}
		const policies = payload.policies || [];
		const sourceJob = payload.sourceJobId
			? jobs.find((job) => job.id === payload.sourceJobId)
			: undefined;
		const controller = new AbortController();
		forgeAbortRef.current = controller;
		setForgeParamsOpen(false);
		setView("forge");
		setForging({
			startedAt: Date.now(),
			policies,
			policySource: sourceJob
				? { kind: "analyzer", jobId: sourceJob.id, scannedAt: sourceJob.startedAt }
				: { kind: "manual" },
			rulesRef: payload.rulesRef,
			command: forgeCommandPreview(
				buildScannerForgeArgv(
					{
						policies,
						rulesRef: payload.rulesRef,
						fileName: payload.fileName || FORGE_DEFAULT_FILE_NAME,
						extras: payload.extras,
					},
					forgeSchema
				)
			),
		});
		try {
			const response = await fetch(`/api/scanners/${encodeURIComponent(selected.id)}/forge`, {
				method: "POST",
				headers: getRequestHeaders({ "Content-Type": "application/json" }),
				body: JSON.stringify(payload),
				signal: controller.signal,
			});
			const body = await response.json();
			if (!response.ok) {
				throw new Error(typeof body === "string" ? body : body?.err || messages.SCANNER_FORGE_FAILED);
			}
			const run = body?.run as ScannerForgeRun | undefined;
			if (run?.id) {
				setForgeRunId(run.id);
				if (run.target) {
					// Set the ref too: the reload below must not wait for a render to see it.
					repoKeyRef.current = scannerRepoKey(run.target) || run.target;
					setRepoKey(repoKeyRef.current);
				}
			}
			if (run?.status === "succeeded") toast.success(messages.SCANNER_FORGE_DONE, { id: "scanner-forge" });
			else toast.error(run?.error || messages.SCANNER_FORGE_FAILED, { id: "scanner-forge" });
		} catch (error) {
			if (controller.signal.aborted) {
				toast.info(messages.SCANNER_FORGE_CANCELLED, { id: "scanner-forge" });
			} else {
				toast.error(error instanceof Error ? error.message : messages.SCANNER_FORGE_FAILED, {
					id: "scanner-forge",
				});
			}
		} finally {
			if (forgeAbortRef.current === controller) forgeAbortRef.current = null;
			setForging(undefined);
			await load({ quiet: true });
		}
	};

	const cancelForge = () => {
		forgeAbortRef.current?.abort();
	};

	const regenerateForge = (run: ScannerForgeRun) => {
		void runForge({
			target: run.target,
			policies: run.policies,
			rulesRef: run.rulesRef,
			fileName: run.fileName,
			extras: run.extras,
			sourceJobId: run.policySource.jobId,
		});
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
									<DropdownMenuContent align="end" className="w-72">
										{forgeEnabled ? (
											<DropdownMenuLabel className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">
												<Play className="size-3" />
												{messages.SCANNER_MENU_ANALYZER}
											</DropdownMenuLabel>
										) : null}
										<DropdownMenuItem onSelect={() => void runScan()}>
											{messages.SCANNER_RUN_DEFAULTS}
										</DropdownMenuItem>
										<DropdownMenuItem onSelect={() => setParamsOpen(true)}>
											{messages.SCANNER_RUN_PARAMS}
										</DropdownMenuItem>
										{forgeEnabled ? (
											<>
												<DropdownMenuSeparator />
												<DropdownMenuLabel className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">
													<Hammer className="size-3" />
													{messages.SCANNER_MENU_FORGE}
												</DropdownMenuLabel>
												<DropdownMenuItem
													className="flex-col items-start gap-0.5"
													disabled={Boolean(forging)}
													onSelect={() => void runForge()}
												>
													<span>{messages.SCANNER_FORGE_RUN}</span>
													<span className="text-[10px] text-muted-foreground">
														{forgePrefill
															? messages.SCANNER_FORGE_RUN_HINT(forgePrefill.policies.join(", "))
															: messages.SCANNER_FORGE_RUN_HINT_EMPTY}
													</span>
												</DropdownMenuItem>
												<DropdownMenuItem
													disabled={Boolean(forging)}
													onSelect={() => setForgeParamsOpen(true)}
												>
													{messages.SCANNER_FORGE_RUN_PARAMS}
												</DropdownMenuItem>
											</>
										) : null}
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
						<div className="flex min-h-11 items-center gap-2 overflow-x-auto border-b border-stone-200 px-3 py-1.5 dark:border-stone-800">
							<Select
								value={selected?.id || ""}
								onValueChange={(next) => {
									setConnectorId(next);
									const connector = connectors.find((item) => item.id === next);
									const nextJobs = connector?.jobs || [];
									const nextDefault =
										typeof parseSettings(connector?.settings).target === "string"
											? String(parseSettings(connector?.settings).target)
											: "";
									const groups = groupScannerJobsByRepo(
										nextJobs,
										nextDefault,
										forgeRunTargets(connector)
									);
									setRepoKey(groups[0]?.repoKey || "");
									setJobId(groups[0]?.jobs[0]?.id || "");
									setForgeRunId("");
									if (!connector?.capabilities?.forge) setView("analyzer");
									setFinding(null);
									setAlertNumber(undefined);
								}}
								disabled={loading}
							>
								<SelectTrigger
									aria-label={messages.SCANNER_CONNECTOR_LABEL}
									className={toolbarSelectTriggerClass}
								>
									<ToolbarSelectValue
										icon={<ConnectorMark type={selected?.type || "trustabl"} size={14} />}
										label={messages.SCANNER_CONNECTOR_LABEL}
										value={selected?.name}
									/>
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
							{repoGroups.length ? (
								<Select
									value={selectedRepo?.repoKey}
									onValueChange={(next) => {
										const group = repoGroups.find((item) => item.repoKey === next);
										setRepoKey(next);
										setJobId(group?.jobs[0]?.id || "");
										setForgeRunId("");
										setFinding(null);
										setAlertNumber(undefined);
									}}
									disabled={loading}
								>
									<SelectTrigger
										aria-label={messages.SCANNER_REPOSITORY_LABEL}
										className={toolbarSelectTriggerClass}
									>
										<ToolbarSelectValue
											icon={<GitBranch className="size-3.5 shrink-0 text-stone-500" />}
											label={messages.SCANNER_REPOSITORY_LABEL}
											value={selectedRepo?.label}
										/>
									</SelectTrigger>
									<SelectContent>
										{repoGroups.map((group) => (
											<SelectItem key={group.repoKey} value={group.repoKey}>
												{group.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							) : (
								<span className="shrink-0 text-xs text-muted-foreground">{messages.SCANNER_NO_REPOS}</span>
							)}
							{selected?.type === "trustabl" ? (
								<div className="ml-auto shrink-0">
									<ScannerRuntimePanel
										compact
										onRuntimeChange={handleRuntimeChange}
									/>
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
							{forgeEnabled ? (
								<Tabs value={view} onValueChange={(next) => setView(next as ScannerView)}>
									<TabsList className="h-9 w-full justify-start gap-1 rounded-none border-b border-stone-200 bg-transparent px-3 py-0 dark:border-stone-800">
										<TabsTrigger value="analyzer" className={scannerTabClass}>
											<ShieldCheck className="size-3.5" />
											{messages.SCANNER_TAB_ANALYZER}
											<span className="rounded bg-stone-100 px-1 font-mono text-[10px] tabular-nums text-stone-600 dark:bg-stone-800 dark:text-stone-300">
												{selectedJob?.findingCount ?? selectedJob?.findings?.length ?? 0}
											</span>
										</TabsTrigger>
										<TabsTrigger value="forge" className={scannerTabClass}>
											<FileCode2 className="size-3.5" />
											{messages.SCANNER_TAB_FORGE}
											{forgeStatus ? <ScannerForgeStatusBadge status={forgeStatus} /> : null}
										</TabsTrigger>
									</TabsList>
								</Tabs>
							) : null}
							{forgeEnabled && view === "forge" ? (
								<ScannerForgePanel
									key={`forge-${selectedRepo?.repoKey || "empty"}`}
									runs={repoForgeRuns}
									selectedRun={selectedForgeRun}
									onSelectRun={setForgeRunId}
									forging={forging}
									onCancel={cancelForge}
									prefillPolicies={forgePrefill?.policies || []}
									onRunForge={() => void runForge()}
									onRegenerate={regenerateForge}
									detail={forgeRun.detail}
									check={forgeRun.check}
									loadingDetail={forgeRun.loading}
									loadError={forgeRun.error}
								/>
							) : (
								<ScannerWorkspace
									key={selectedRepo?.repoKey || "empty"}
									connectorId={selected?.id}
									repoLabel={selectedRepo?.label}
									jobs={repoJobs}
									selectedJob={selectedJob}
									previousJob={previousJob}
									onSelectJob={(next) => {
										setJobId(next);
										setFinding(null);
										setAlertNumber(undefined);
									}}
									onOpenFinding={(item, number) => {
										setFinding(item);
										setAlertNumber(number);
									}}
								/>
							)}
						</div>
					)}
				</div>
			</FeatureAccess>

			{paramsOpen ? (
				<ScannerRunParamsDialog
					open={paramsOpen}
					defaults={runDefaults}
					schema={cliSchema}
					onClose={() => setParamsOpen(false)}
					onRun={(input) => void runScan(input)}
				/>
			) : null}
			{forgeParamsOpen ? (
				<ScannerForgeParamsDialog
					open={forgeParamsOpen}
					defaults={forgeDefaults}
					prefill={forgePrefill}
					schema={forgeSchema}
					onClose={() => setForgeParamsOpen(false)}
					onRun={(input) => void runForge(input)}
				/>
			) : null}
			<ScannerFindingSheet
				open={Boolean(finding)}
				finding={finding}
				alertNumber={alertNumber}
				job={selectedJob}
				onClose={() => {
					setFinding(null);
					setAlertNumber(undefined);
				}}
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
