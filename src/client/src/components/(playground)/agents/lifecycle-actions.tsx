"use client";

/**
 * LifecycleActions — Play / Stop / Restart for controller-managed
 * workloads. Used by the agents list table (per-row, right-aligned
 * "Actions" column) and the agent detail page (header `rightSlot`).
 *
 * Visual style mirrors Docker Desktop's container actions: the buttons
 * sit inside a single bordered pill with internal dividers, so the
 * affordance is always visible without hover. Two variants:
 *
 *   - `row`    : compact 28px icon buttons for the agents table.
 *   - `header` : 36px icon buttons with a touch more padding for the
 *                agent-detail header bar — large enough to be obvious
 *                next to the version chooser, small enough to not
 *                dominate the layout.
 *
 * Hidden entirely for SDK-only rows (no controller, no lifecycle to
 * manage) and gracefully no-ops when the controller has not advertised
 * `lifecycle_*_v1` capabilities yet (in that case the API returns 409
 * and the toast surfaces the reason).
 *
 * State transitions flow through the shared observability-view so the
 * spinner / direction / desired-mismatch precedence is the same as the
 * LLM + Agent cells. Stop is the only destructive action and always
 * opens a confirmation dialog.
 */

import { useState } from "react";
import { Loader2, Play, RotateCcw, Square } from "lucide-react";
import { toast } from "sonner";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import getMessage from "@/constants/messages";
import {
	getObservabilityView,
	type Direction,
} from "@/lib/platform/agents/observability-view";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { useRootStore } from "@/store";
import {
	getClearAgentIntent,
	getSetAgentIntent,
	useAgentIntent,
} from "@/selectors/agents-instrumentation";
import type { UnifiedAgent } from "@/types/agents";

export type LifecycleActionsVariant = "row" | "header";

interface LifecycleActionsProps {
	agent: UnifiedAgent;
	onRefresh: () => void;
	variant?: LifecycleActionsVariant;
}

function directionLabel(direction: Direction | null): string {
	switch (direction) {
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

const SIZES: Record<
	LifecycleActionsVariant,
	{ button: string; icon: string; pill: string }
> = {
	row: {
		button: "w-8 h-8",
		icon: "w-3.5 h-3.5",
		pill: "h-8",
	},
	header: {
		button: "w-9 h-9",
		icon: "w-4 h-4",
		pill: "h-9",
	},
};

export default function LifecycleActions({
	agent,
	onRefresh,
	variant = "row",
}: LifecycleActionsProps) {
	const { fireRequest, isLoading } = useFetchWrapper();
	const setIntent = useRootStore(getSetAgentIntent);
	const clearIntent = useRootStore(getClearAgentIntent);
	const intent = useAgentIntent(agent.agent_key, "lifecycle");
	// Symmetric to useObservabilityBlock in service-table.tsx: while
	// LLM or Agent observability is mid-instrument, we don't want the
	// user racing a Stop / Restart against that operation. The cheapest
	// fix is to disable the lifecycle pill and surface the reason in a
	// tooltip. Both reads go through getObservabilityView so the
	// optimistic-intent / pending-action / desired-mismatch precedence
	// is the same one used everywhere else.
	const llmIntent = useAgentIntent(agent.agent_key, "llm");
	const agentIntent = useAgentIntent(agent.agent_key, "agent");
	const [confirmStopOpen, setConfirmStopOpen] = useState(false);

	const controllerServiceId = agent.controller_service_id;
	if (agent.source === "sdk" || !controllerServiceId) {
		return null;
	}

	const view = getObservabilityView(agent, "lifecycle", intent);
	const llmView = getObservabilityView(agent, "llm", llmIntent);
	const agentView = getObservabilityView(agent, "agent", agentIntent);
	const observabilityInFlight =
		llmView.transitioning || agentView.transitioning;
	const running = view.enabled;
	const sz = SIZES[variant];

	async function fire(
		action: "start" | "stop" | "restart",
		direction: "starting" | "stopping" | "restarting"
	) {
		if (view.transitioning) return;
		setIntent(agent.agent_key, "lifecycle", direction);
		await fireRequest({
			requestType: "POST",
			url: `/api/controller/catalog/${controllerServiceId}/${action}`,
			successCb: () => {
				const queued =
					action === "start"
						? getMessage().AGENTS_LIFECYCLE_QUEUED_PLAY(agent.service_name)
						: action === "stop"
							? getMessage().AGENTS_LIFECYCLE_QUEUED_STOP(agent.service_name)
							: getMessage().AGENTS_LIFECYCLE_QUEUED_RESTART(agent.service_name);
				toast.success(queued);
				onRefresh();
			},
			failureCb: (err: any) => {
				clearIntent(agent.agent_key, "lifecycle");
				toast.error(getMessage().AGENTS_LIFECYCLE_FAILED(err));
			},
		});
	}

	// Shared pill shell — one bordered container with internal dividers
	// between buttons, so the action affordances are visible even when
	// the cursor is nowhere near them. Matches Docker Desktop's
	// container-row actions cluster.
	const pillBase = `inline-flex ${sz.pill} items-center rounded-md border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 overflow-hidden divide-x divide-stone-200 dark:divide-stone-700 shadow-sm`;
	const buttonBase = `inline-flex items-center justify-center ${sz.button} disabled:opacity-50 disabled:cursor-not-allowed transition-colors`;

	if (view.transitioning) {
		return (
			<div className={pillBase} aria-busy="true" aria-label={directionLabel(view.direction)}>
				<span
					className={`${buttonBase} text-stone-500 dark:text-stone-400`}
					title={directionLabel(view.direction)}
				>
					<Loader2 className={`${sz.icon} animate-spin`} />
				</span>
			</div>
		);
	}

	// Observability-in-flight branch: keep the action affordance visible
	// so users understand *what* would happen, but render it as a
	// disabled pill with the explanatory tooltip. Stop/Restart vs. Play
	// shape stays consistent with the live state so reading the row
	// does not require a translation.
	if (observabilityInFlight) {
		const blockTooltip =
			getMessage().AGENTS_LIFECYCLE_DISABLED_OBSERVABILITY_TRANSITIONING;
		const disabledButton = (
			node: React.ReactNode,
			ariaLabel: string,
			extraColor: string
		) => (
			<span
				className={`${buttonBase} ${extraColor} opacity-50 cursor-not-allowed`}
				title={blockTooltip}
				aria-label={ariaLabel}
				aria-disabled="true"
			>
				{node}
			</span>
		);
		return (
			<div className={pillBase} onClick={(e) => e.stopPropagation()}>
				{!running
					? disabledButton(
							<Play className={sz.icon} />,
							getMessage().AGENTS_LIFECYCLE_PLAY,
							"text-green-600 dark:text-green-400"
						)
					: (
							<>
								{disabledButton(
									<Square className={`${sz.icon} fill-current`} />,
									getMessage().AGENTS_LIFECYCLE_STOP,
									"text-red-600 dark:text-red-400"
								)}
								{disabledButton(
									<RotateCcw className={sz.icon} />,
									getMessage().AGENTS_LIFECYCLE_RESTART,
									"text-stone-600 dark:text-stone-300"
								)}
							</>
						)}
			</div>
		);
	}

	return (
		<>
			<div className={pillBase} onClick={(e) => e.stopPropagation()}>
				{!running ? (
					<button
						onClick={(e) => {
							e.stopPropagation();
							fire("start", "starting");
						}}
						disabled={isLoading}
						title={getMessage().AGENTS_LIFECYCLE_TOOLTIP_PLAY}
						aria-label={getMessage().AGENTS_LIFECYCLE_PLAY}
						className={`${buttonBase} text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950/40`}
					>
						<Play className={sz.icon} />
					</button>
				) : (
					<>
						<button
							onClick={(e) => {
								e.stopPropagation();
								setConfirmStopOpen(true);
							}}
							disabled={isLoading}
							title={getMessage().AGENTS_LIFECYCLE_TOOLTIP_STOP}
							aria-label={getMessage().AGENTS_LIFECYCLE_STOP}
							className={`${buttonBase} text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40`}
						>
							<Square className={`${sz.icon} fill-current`} />
						</button>
						<button
							onClick={(e) => {
								e.stopPropagation();
								fire("restart", "restarting");
							}}
							disabled={isLoading}
							title={getMessage().AGENTS_LIFECYCLE_TOOLTIP_RESTART}
							aria-label={getMessage().AGENTS_LIFECYCLE_RESTART}
							className={`${buttonBase} text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800`}
						>
							<RotateCcw className={sz.icon} />
						</button>
					</>
				)}
			</div>
			<Dialog open={confirmStopOpen} onOpenChange={setConfirmStopOpen}>
				<DialogContent
					onClick={(e) => e.stopPropagation()}
					className="sm:max-w-md"
				>
					<DialogHeader>
						<DialogTitle>
							{getMessage().AGENTS_LIFECYCLE_CONFIRM_STOP_TITLE}
						</DialogTitle>
						<DialogDescription>
							{getMessage().AGENTS_LIFECYCLE_CONFIRM_STOP_DESCRIPTION(
								agent.service_name
							)}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<button
							type="button"
							onClick={() => setConfirmStopOpen(false)}
							className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-md border border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-800"
						>
							{getMessage().AGENTS_LIFECYCLE_CONFIRM_STOP_CANCEL}
						</button>
						<button
							type="button"
							onClick={() => {
								setConfirmStopOpen(false);
								fire("stop", "stopping");
							}}
							className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-md bg-red-600 text-white hover:bg-red-700"
						>
							{getMessage().AGENTS_LIFECYCLE_CONFIRM_STOP_CONFIRM}
						</button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
