"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import type {
	ControllerInstance,
} from "@/types/controller";
import type { UnifiedAgent } from "@/types/agents";
import { Columns } from "@/components/data-table/columns";
import DataTable from "@/components/data-table/table";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { formatBrowserDateTime } from "@/utils/date";
import { toast } from "sonner";
import LinuxSvg from "@/components/svg/linux";
import KubernetesSvg from "@/components/svg/kubernetes";
import DockerSvg from "@/components/svg/docker";
import { ProviderIcon } from "@/components/svg/providers";
import getMessage from "@/constants/messages";
import {
	getObservabilityView,
	type Feature,
} from "@/lib/platform/agents/observability-view";
import { useRootStore } from "@/store";
import {
	getClearAgentIntent,
	getSetAgentIntent,
	useAgentIntent,
} from "@/selectors/agents-instrumentation";
import LifecycleActions from "@/components/(playground)/agents/lifecycle-actions";

interface ServiceTableProps {
	services: UnifiedAgent[];
	instances: ControllerInstance[];
	onRefresh: () => void;
	isFetched: boolean;
	isLoading: boolean;
	/** Status + provider filtering happens server-side now; only the
	 * system filter (kubernetes / docker / linux) remains client-side
	 * because it depends on the controller-instance mode join. */
	systemFilter: string[];
}

interface EnrichedAgent extends UnifiedAgent {
	mode: "linux" | "docker" | "kubernetes" | "standalone";
	/** True when the row is backed only by the SDK (no controller actions possible). */
	isSdkOnly: boolean;
}

type ServiceColumnKey =
	| "service"
	| "system"
	| "providers"
	| "lifecycle"
	| "aiObservability"
	| "agentObservability"
	| "lastSeen";

function StaticDash() {
	return <span className="text-xs text-stone-400 dark:text-stone-500">—</span>;
}

/**
 * Returns a tooltip string describing *why* observability changes
 * should be blocked for this agent, or `null` when the agent is in a
 * state where toggling LLM / Agent observability is safe.
 *
 * We gate on the lifecycle observability-view so the same precedence
 * (optimistic intent → pending action → desired mismatch → steady)
 * decides what counts as "running" — that way clicking Stop in one
 * row instantly disables its o11y toggles via the optimistic intent,
 * without waiting for the controller round-trip.
 *
 * Controllers can mutate processes only while they exist: Docker /
 * Linux modes literally have nothing to attach to once the workload
 * is stopped, and a K8s instrument racing a Stop can leave a
 * half-applied state. Gating closes that race entirely.
 */
function useObservabilityBlock(service: EnrichedAgent): string | null {
	const lifecycleIntent = useAgentIntent(service.agent_key, "lifecycle");
	if (service.source === "sdk" || !service.controller_service_id) {
		return null;
	}
	const lifecycleView = getObservabilityView(
		service,
		"lifecycle",
		lifecycleIntent
	);
	if (lifecycleView.transitioning) {
		return getMessage().AGENTS_OBSERVABILITY_DISABLED_TRANSITIONING;
	}
	if (!lifecycleView.enabled) {
		return getMessage().AGENTS_OBSERVABILITY_DISABLED_NOT_RUNNING;
	}
	return null;
}

function directionLabel(
	direction:
		| "enabling"
		| "disabling"
		| "starting"
		| "stopping"
		| "restarting"
		| null
): string {
	switch (direction) {
		case "disabling":
			return getMessage().AGENTS_SERVICE_ACTION_DISABLING;
		case "enabling":
			return getMessage().AGENTS_SERVICE_ACTION_ENABLING;
		case "starting":
			return getMessage().AGENTS_LIFECYCLE_STARTING;
		case "stopping":
			return getMessage().AGENTS_LIFECYCLE_STOPPING;
		case "restarting":
			return getMessage().AGENTS_LIFECYCLE_RESTARTING;
		default:
			return getMessage().AGENTS_SERVICE_ACTION_WORKING;
	}
}

function AIObservabilityCell({
	service,
	onRefresh,
}: {
	service: EnrichedAgent;
	onRefresh: () => void;
}) {
	const { fireRequest, isLoading } = useFetchWrapper();
	const setIntent = useRootStore(getSetAgentIntent);
	const clearIntent = useRootStore(getClearAgentIntent);
	const intent = useAgentIntent(service.agent_key, "llm");
	const blockReason = useObservabilityBlock(service);
	const controllerServiceId = service.controller_service_id;

	if (!controllerServiceId) {
		return <StaticDash />;
	}

	const view = getObservabilityView(service, "llm", intent);

	// Stopped or transitioning lifecycle → render a disabled button that
	// still reflects current state, with a tooltip explaining why it is
	// inert. We keep the Enable/Disable label honest so a user who comes
	// back later understands what *will* happen once the agent is back.
	if (blockReason && !view.transitioning) {
		const label = view.enabled
			? getMessage().AGENTS_SERVICE_ACTION_DISABLE
			: getMessage().AGENTS_SERVICE_ACTION_ENABLE;
		return (
			<button
				type="button"
				disabled
				title={blockReason}
				aria-label={blockReason}
				onClick={(e) => e.stopPropagation()}
				className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-stone-200 dark:border-stone-700 text-stone-400 dark:text-stone-500 bg-stone-50 dark:bg-stone-900 cursor-not-allowed"
			>
				{label}
			</button>
		);
	}

	const handleAction = async (e: React.MouseEvent) => {
		e.stopPropagation();
		if (view.transitioning) return;
		const enabling = !view.enabled;
		const action = enabling ? "instrument" : "uninstrument";
		setIntent(service.agent_key, "llm", enabling ? "enabling" : "disabling");
		await fireRequest({
			requestType: "POST",
			url: `/api/controller/catalog/${controllerServiceId}/${action}`,
			successCb: () => {
				toast.success(
					getMessage().AGENTS_SERVICE_QUEUED_ACTION(action, service.service_name)
				);
				onRefresh();
			},
			failureCb: (err: any) => {
				clearIntent(service.agent_key, "llm");
				toast.error(getMessage().AGENTS_SERVICE_FAILED(err));
			},
		});
	};

	if (view.transitioning) {
		return (
			<button
				disabled
				className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-stone-200 dark:border-stone-700 text-stone-500 dark:text-stone-300 bg-stone-50 dark:bg-stone-800 opacity-80"
			>
				<Loader2 className="w-3 h-3 animate-spin" />
				{directionLabel(view.direction)}
			</button>
		);
	}

	if (!view.enabled) {
		return (
			<button
				onClick={handleAction}
				disabled={isLoading}
				className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 hover:bg-stone-700 dark:hover:bg-stone-200 transition-colors disabled:opacity-50"
			>
				{isLoading && <Loader2 className="w-3 h-3 animate-spin" />}
				{isLoading
					? getMessage().AGENTS_SERVICE_ACTION_WORKING
					: getMessage().AGENTS_SERVICE_ACTION_ENABLE}
			</button>
		);
	}

	return (
		<button
			onClick={handleAction}
			disabled={isLoading}
			className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors disabled:opacity-50"
		>
			{isLoading && <Loader2 className="w-3 h-3 animate-spin" />}
			{isLoading
				? getMessage().AGENTS_SERVICE_ACTION_WORKING
				: getMessage().AGENTS_SERVICE_ACTION_DISABLE}
		</button>
	);
}

function AgentObservabilityCell({
	service,
	onRefresh,
}: {
	service: EnrichedAgent;
	onRefresh: () => void;
}) {
	const { fireRequest, isLoading } = useFetchWrapper();
	const setIntent = useRootStore(getSetAgentIntent);
	const clearIntent = useRootStore(getClearAgentIntent);
	const intent = useAgentIntent(service.agent_key, "agent");
	const blockReason = useObservabilityBlock(service);
	const controllerServiceId = service.controller_service_id;

	if (!controllerServiceId) {
		return <StaticDash />;
	}

	const view = getObservabilityView(service, "agent", intent);
	// `manual` is a special-case state — the SDK was wired up by hand rather
	// than via the controller, so we still want to offer a Disable button but
	// flag the row visually. `view.isManual` is the canonical semantic read.
	const isManual = view.isManual;

	// Lifecycle gating: same logic as the LLM cell, but we still want to
	// surface the `manual` badge so users can see the SDK status; we just
	// disable the Disable button until the agent is running.
	if (blockReason && !view.transitioning) {
		const label = isManual
			? getMessage().AGENTS_SERVICE_ACTION_DISABLE
			: view.enabled
				? getMessage().AGENTS_SERVICE_ACTION_DISABLE
				: getMessage().AGENTS_SERVICE_ACTION_ENABLE;
		return (
			<div className="flex items-center gap-2">
				{isManual && (
					<span className="inline-flex items-center px-2 py-0.5 text-[10px] font-semibold rounded-full bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
						{getMessage().AGENTS_SERVICE_MANUAL_BADGE}
					</span>
				)}
				<button
					type="button"
					disabled
					title={blockReason}
					aria-label={blockReason}
					onClick={(e) => e.stopPropagation()}
					className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-stone-200 dark:border-stone-700 text-stone-400 dark:text-stone-500 bg-stone-50 dark:bg-stone-900 cursor-not-allowed"
				>
					{label}
				</button>
			</div>
		);
	}

	const handleAction = async (e: React.MouseEvent) => {
		e.stopPropagation();
		if (view.transitioning) return;
		const enabling = !view.enabled && !isManual;
		setIntent(
			service.agent_key,
			"agent",
			enabling ? "enabling" : "disabling"
		);
		await fireRequest({
			requestType: enabling ? "POST" : "DELETE",
			url: `/api/controller/catalog/${controllerServiceId}/agent-instrument`,
			successCb: () => {
				toast.success(
					enabling
						? getMessage().AGENTS_AGENT_ENABLING_FOR(service.service_name)
						: getMessage().AGENTS_AGENT_DISABLING_FOR(service.service_name)
				);
				onRefresh();
			},
			failureCb: (err: any) => {
				clearIntent(service.agent_key, "agent");
				toast.error(getMessage().AGENTS_SERVICE_FAILED(err));
			},
		});
	};

	if (view.transitioning) {
		return (
			<button
				disabled
				className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-stone-200 dark:border-stone-700 text-stone-500 dark:text-stone-300 bg-stone-50 dark:bg-stone-800 opacity-80"
			>
				<Loader2 className="w-3 h-3 animate-spin" />
				{directionLabel(view.direction)}
			</button>
		);
	}

	if (isManual) {
		return (
			<div className="flex items-center gap-2">
				<span className="inline-flex items-center px-2 py-0.5 text-[10px] font-semibold rounded-full bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
					{getMessage().AGENTS_SERVICE_MANUAL_BADGE}
				</span>
				<button
					onClick={handleAction}
					disabled={isLoading}
					className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors disabled:opacity-50"
				>
					{isLoading && <Loader2 className="w-3 h-3 animate-spin" />}
					{isLoading
						? getMessage().AGENTS_SERVICE_ACTION_ELLIPSIS
						: getMessage().AGENTS_SERVICE_ACTION_DISABLE}
				</button>
			</div>
		);
	}

	if (!view.enabled) {
		return (
			<button
				onClick={handleAction}
				disabled={isLoading}
				className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 hover:bg-stone-700 dark:hover:bg-stone-200 transition-colors disabled:opacity-50"
			>
				{isLoading && <Loader2 className="w-3 h-3 animate-spin" />}
				{isLoading
					? getMessage().AGENTS_SERVICE_ACTION_WORKING
					: getMessage().AGENTS_SERVICE_ACTION_ENABLE}
			</button>
		);
	}

	return (
		<button
			onClick={handleAction}
			disabled={isLoading}
			className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors disabled:opacity-50"
		>
			{isLoading && <Loader2 className="w-3 h-3 animate-spin" />}
			{isLoading
				? getMessage().AGENTS_SERVICE_ACTION_WORKING
				: getMessage().AGENTS_SERVICE_ACTION_DISABLE}
		</button>
	);
}

/**
 * ActionsCell — Docker-Desktop-style action cluster pinned to the
 * right of the row. SDK-only agents (no controller managing them)
 * render an em-dash so the right edge stays visually clean instead of
 * showing nothing at all; controller-managed rows render the full
 * Play / Stop / Restart pill from LifecycleActions.
 */
function ActionsCell({
	service,
	onRefresh,
}: {
	service: EnrichedAgent;
	onRefresh: () => void;
}) {
	return (
		<div className="flex justify-end">
			{service.source === "sdk" || !service.controller_service_id ? (
				<StaticDash />
			) : (
				<LifecycleActions
					agent={service}
					onRefresh={onRefresh}
					variant="row"
				/>
			)}
		</div>
	);
}

const columns: Columns<ServiceColumnKey, EnrichedAgent> = {
	service: {
		header: () => getMessage().AGENTS_COLUMN_SERVICE,
		cell: ({ row }) => (
			<div className="flex items-center gap-2 overflow-hidden">
				<Link
					href={`/agents/${row.agent_key}?from=services`}
					className="font-medium text-stone-900 dark:text-stone-100 hover:underline truncate"
					onClick={(e) => e.stopPropagation()}
				>
					{row.service_name}
				</Link>
				{row.cluster_id && row.cluster_id !== "default" && (
					<span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 border border-blue-200 dark:border-blue-800 flex-shrink-0">
						{row.cluster_id}
					</span>
				)}
				{row.environment && row.environment !== "default" && (
					<span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400 border border-stone-200 dark:border-stone-700 flex-shrink-0">
						{row.environment}
					</span>
				)}
			</div>
		),
		enableHiding: false,
	},
	system: {
		header: () => getMessage().AGENTS_COLUMN_SYSTEM,
		cell: ({ row }) => {
			if (row.isSdkOnly) {
				return <span className="text-xs text-stone-400 dark:text-stone-500">—</span>;
			}
			const title =
				row.mode === "kubernetes"
					? getMessage().AGENTS_SYSTEM_KUBERNETES
					: row.mode === "docker"
						? getMessage().AGENTS_SYSTEM_DOCKER
						: getMessage().AGENTS_SYSTEM_LINUX;
			return (
				<div
					className="flex items-center text-stone-600 dark:text-stone-400"
					title={title}
				>
					{row.mode === "kubernetes" ? (
						<KubernetesSvg className="w-5 h-5" />
					) : row.mode === "docker" ? (
						<DockerSvg className="w-5 h-5" />
					) : (
						<LinuxSvg className="w-5 h-5" />
					)}
				</div>
			);
		},
	},
	providers: {
		header: () => getMessage().AGENTS_COLUMN_PROVIDERS,
		cell: ({ row }) => (
			<div className="flex items-center gap-2">
				{row.providers && row.providers.length > 0 ? (
					row.providers.map((p) => (
						<span key={p} title={p}>
							<ProviderIcon provider={p} className="w-5 h-5" />
						</span>
					))
				) : (
					<span className="text-stone-400">—</span>
				)}
			</div>
		),
	},
	lastSeen: {
		header: () => getMessage().AGENTS_COLUMN_LAST_SEEN,
		cell: ({ row }) => (
			<span className="text-xs truncate">
				{formatBrowserDateTime(row.last_seen)}
			</span>
		),
	},
	lifecycle: {
		header: () => (
			<div className="flex justify-end">
				{getMessage().AGENTS_COLUMN_ACTIONS}
			</div>
		),
		cell: ({ row, extraFunctions }) => (
			<ActionsCell service={row} onRefresh={extraFunctions.onRefresh} />
		),
		enableHiding: false,
	},
	aiObservability: {
		header: () => getMessage().AGENTS_COLUMN_LLM_OBSERVABILITY,
		cell: ({ row, extraFunctions }) => (
			<AIObservabilityCell service={row} onRefresh={extraFunctions.onRefresh} />
		),
	},
	agentObservability: {
		header: () => getMessage().AGENTS_COLUMN_AGENT_OBSERVABILITY,
		cell: ({ row, extraFunctions }) => (
			<AgentObservabilityCell service={row} onRefresh={extraFunctions.onRefresh} />
		),
	},
};

// Column display order is driven by this record's key order (see
// DataTable). `lifecycle` is intentionally last so the action pill
// pins to the right of the row, matching Docker Desktop's container
// list layout.
const VISIBILITY_COLUMNS: Record<ServiceColumnKey, boolean> = {
	service: true,
	system: true,
	providers: true,
	lastSeen: true,
	aiObservability: true,
	agentObservability: true,
	lifecycle: true,
};

export default function ServiceTable({
	services,
	instances,
	onRefresh,
	isFetched,
	isLoading,
	systemFilter,
}: ServiceTableProps) {
	const router = useRouter();
	const instanceMap = useMemo(() => {
		const map = new Map<string, ControllerInstance>();
		for (const inst of instances) {
			map.set(inst.instance_id, inst);
		}
		return map;
	}, [instances]);

	const enriched: EnrichedAgent[] = useMemo(() => {
		return services.map((svc) => {
			const inst = svc.controller_instance_id
				? instanceMap.get(svc.controller_instance_id)
				: undefined;
			return {
				...svc,
				mode: inst?.mode || "linux",
				isSdkOnly: svc.source === "sdk",
			};
		});
	}, [services, instanceMap]);

	// statusFilter and providerFilter are pushed to /api/agents server-side,
	// so the rows we receive are already narrowed. Only systemFilter remains
	// client-side because it depends on the controller-instance join (mode)
	// which is not stored on openlit_agents_summary.
	const filtered = useMemo(() => {
		if (systemFilter.length === 0) return enriched;
		return enriched.filter((svc) => {
			return systemFilter.some((sf) => {
				if (svc.isSdkOnly) return false;
				if (sf === "kubernetes") return svc.mode === "kubernetes";
				if (sf === "docker")
					return svc.mode === "docker" || svc.mode === "standalone";
				if (sf === "linux") return svc.mode === "linux";
				return false;
			});
		});
	}, [enriched, systemFilter]);

	return (
		<DataTable
			columns={columns}
			data={filtered}
			isFetched={isFetched}
			isLoading={isLoading}
			visibilityColumns={VISIBILITY_COLUMNS}
			extraFunctions={{ onRefresh }}
			onClick={(row) =>
				router.push(`/agents/${row.agent_key}?from=services`)
			}
		/>
	);
}

// Re-export `Feature` so other internal modules can import it without
// chasing through observability-view. Keeps the surface area small.
export type { Feature };
