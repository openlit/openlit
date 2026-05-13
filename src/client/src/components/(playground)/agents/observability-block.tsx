"use client";

import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import getMessage from "@/constants/messages";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { useRootStore } from "@/store";
import {
	getClearAgentIntent,
	getSetAgentIntent,
} from "@/selectors/agents-instrumentation";
import type { PodSummary } from "@/lib/platform/agents/observability-view";

export type ObservabilityKind = "llm" | "agent";

interface ObservabilityBlockProps {
	kind: ObservabilityKind;
	/** Stable identifier for the agent — used to key optimistic intents in
	 * the Zustand store so a click here mirrors into the list view. */
	agentKey: string;
	/** When provided, the block renders an interactive toggle that calls the
	 *  controller API. When omitted, the block renders a static status pill
	 *  describing the SDK-reported state. */
	controllerServiceId?: string | null;
	/** Current actual status — used to decide the toggle direction. */
	enabled: boolean;
	/** True when an action is in flight (controller-side or optimistic). */
	pending?: boolean;
	// Direction is widened to the full Direction union (which includes
	// lifecycle's starting/stopping/restarting) even though this block
	// only ever renders for llm/agent, because the upstream
	// observability-view now returns the widened type. The renderer
	// below only branches on enabling/disabling so the lifecycle
	// variants are inert here.
	pendingDirection?:
		| "enabling"
		| "disabling"
		| "starting"
		| "stopping"
		| "restarting"
		| null;
	/** Multi-pod rollup so we can show `Pods: ack/total` while a fan-out is
	 * propagating. `null` for SDK-only rows or single-pod workloads. */
	podSummary?: PodSummary | null;
	/** Triggered after a successful action so the parent can refresh. */
	onChange?: () => void;
	serviceName: string;
	/**
	 * If set, the toggle renders as a disabled button with this text as
	 * the tooltip. Used to gate observability changes on lifecycle
	 * state (e.g. the agent is stopped or transitioning) — we don't
	 * want to queue an instrument action against a workload that has
	 * no live process for the controller to attach to.
	 */
	blockReason?: string | null;
}

function kindLabel(kind: ObservabilityKind) {
	return kind === "llm"
		? getMessage().AGENTS_LLM_OBSERVABILITY_LABEL
		: getMessage().AGENTS_AGENT_OBSERVABILITY_LABEL;
}

function kindDescription(kind: ObservabilityKind) {
	return kind === "llm"
		? getMessage().AGENTS_LLM_OBSERVABILITY_DESCRIPTION
		: getMessage().AGENTS_AGENT_OBSERVABILITY_DESCRIPTION;
}

export default function ObservabilityBlock({
	kind,
	agentKey,
	controllerServiceId,
	enabled,
	pending,
	pendingDirection,
	podSummary,
	onChange,
	serviceName,
	blockReason,
}: ObservabilityBlockProps) {
	const { fireRequest, isLoading } = useFetchWrapper();
	const setIntent = useRootStore(getSetAgentIntent);
	const clearIntent = useRootStore(getClearAgentIntent);

	const isStatic = !controllerServiceId;

	const handleToggle = async () => {
		if (!controllerServiceId) return;
		const path = kind === "llm" ? (enabled ? "uninstrument" : "instrument") : "agent-instrument";
		const method: "POST" | "DELETE" =
			kind === "llm" ? "POST" : enabled ? "DELETE" : "POST";
		const direction: "enabling" | "disabling" = enabled
			? "disabling"
			: "enabling";
		setIntent(agentKey, kind, direction);
		await fireRequest({
			requestType: method,
			url: `/api/controller/catalog/${controllerServiceId}/${path}`,
			successCb: () => {
				toast.success(
					kind === "llm"
						? getMessage().AGENTS_SERVICE_QUEUED_ACTION(
								enabled ? "uninstrument" : "instrument",
								serviceName
							)
						: enabled
							? getMessage().AGENTS_AGENT_DISABLING_FOR(serviceName)
							: getMessage().AGENTS_AGENT_ENABLING_FOR(serviceName)
				);
				onChange?.();
			},
			failureCb: (err: any) => {
				clearIntent(agentKey, kind);
				toast.error(getMessage().AGENTS_SERVICE_FAILED(err));
			},
		});
	};

	const showPodCounts =
		!!podSummary && podSummary.total > 1 && (pending ?? false);

	return (
		<div className="flex items-center justify-between p-4 bg-stone-50 dark:bg-stone-800/50 rounded-lg gap-4">
			<div className="min-w-0">
				<div className="font-medium text-stone-900 dark:text-stone-100">
					{kindLabel(kind)}
				</div>
				<div className="text-sm text-stone-500 dark:text-stone-400 mt-1">
					{kindDescription(kind)}
				</div>
				{isStatic && (
					<div className="text-xs text-stone-400 dark:text-stone-500 mt-1.5">
						{getMessage().AGENTS_SOURCE_SDK_LABEL}
					</div>
				)}
				{showPodCounts && podSummary && (
					<div className="text-xs text-stone-500 dark:text-stone-400 mt-2">
						{getMessage().AGENTS_PODS_ACK_PROGRESS(
							podSummary.ack,
							podSummary.total
						)}
					</div>
				)}
			</div>

			<div className="shrink-0">
				{isStatic ? (
					<span
						className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-400 bg-emerald-50/60 dark:bg-emerald-900/20"
						title={getMessage().AGENTS_SOURCE_SDK_LABEL}
					>
						<span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
						{getMessage().AGENTS_SDK_ENABLED_VIA}
					</span>
				) : pending ? (
					<button
						disabled
						className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-stone-200 dark:border-stone-700 text-stone-500 dark:text-stone-300 bg-stone-50 dark:bg-stone-800 opacity-80"
					>
						<Loader2 className="w-3 h-3 animate-spin" />
						{pendingDirection === "disabling"
							? getMessage().AGENTS_SERVICE_ACTION_DISABLING
							: getMessage().AGENTS_SERVICE_ACTION_ENABLING}
					</button>
				) : blockReason ? (
					<button
						type="button"
						disabled
						title={blockReason}
						aria-label={blockReason}
						className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-stone-200 dark:border-stone-700 text-stone-400 dark:text-stone-500 bg-stone-50 dark:bg-stone-900 cursor-not-allowed"
					>
						{enabled
							? getMessage().AGENTS_SERVICE_ACTION_DISABLE
							: getMessage().AGENTS_SERVICE_ACTION_ENABLE}
					</button>
				) : (
					<button
						onClick={handleToggle}
						disabled={isLoading}
						className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors disabled:opacity-50 ${
							enabled
								? "border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30"
								: "bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 hover:bg-stone-800 dark:hover:bg-stone-200"
						}`}
					>
						{isLoading && <Loader2 className="w-3 h-3 animate-spin" />}
						{isLoading
							? getMessage().AGENTS_SERVICE_ACTION_WORKING
							: enabled
								? getMessage().AGENTS_SERVICE_ACTION_DISABLE
								: getMessage().AGENTS_SERVICE_ACTION_ENABLE}
					</button>
				)}
			</div>
		</div>
	);
}
