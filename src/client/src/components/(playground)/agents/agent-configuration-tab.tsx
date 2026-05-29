"use client";

import type { UnifiedAgent } from "@/types/agents";
import getMessage from "@/constants/messages";
import { getObservabilityView } from "@/lib/platform/agents/observability-view";
import { useAgentIntent } from "@/selectors/agents-instrumentation";
import ObservabilityBlock from "./observability-block";

interface AgentConfigurationTabProps {
	agent: UnifiedAgent;
	onRefresh: () => void;
}

/**
 * Configuration tab: surfaces the two observability blocks (LLM /
 * Agent) that used to live in the AgentHeader, plus contextual copy so
 * users know what each toggle does.
 *
 * Both blocks share `getObservabilityView` with the list-view cells so the
 * Configuration tab can no longer drift from the list (the previous bug).
 *
 * Observability toggles are gated on lifecycle state: when the agent
 * is stopped or transitioning, instrumenting (or removing
 * instrumentation) is unsafe — there is no live process for the
 * controller to attach to in Docker / Linux modes, and a K8s instrument
 * action racing a Stop leaves a half-applied state. We block the
 * toggle and surface the reason via the button tooltip rather than
 * silently dropping the click.
 */
export default function AgentConfigurationTab({
	agent,
	onRefresh,
}: AgentConfigurationTabProps) {
	const llmIntent = useAgentIntent(agent.agent_key, "llm");
	const agentIntent = useAgentIntent(agent.agent_key, "agent");
	const lifecycleIntent = useAgentIntent(agent.agent_key, "lifecycle");
	const llmView = getObservabilityView(agent, "llm", llmIntent);
	const agentView = getObservabilityView(agent, "agent", agentIntent);
	const lifecycleView = getObservabilityView(
		agent,
		"lifecycle",
		lifecycleIntent
	);

	// Only controller-managed agents have a real lifecycle to gate on.
	// SDK-only rows fall through to ObservabilityBlock's static branch
	// anyway, so passing null here is correct.
	const isControllerManaged =
		agent.source !== "sdk" && !!agent.controller_service_id;
	let blockReason: string | null = null;
	if (isControllerManaged) {
		if (lifecycleView.transitioning) {
			blockReason = getMessage().AGENTS_OBSERVABILITY_DISABLED_TRANSITIONING;
		} else if (!lifecycleView.enabled) {
			blockReason = getMessage().AGENTS_OBSERVABILITY_DISABLED_NOT_RUNNING;
		}
	}

	return (
		<div className="space-y-4">
			<p className="text-sm text-stone-500 dark:text-stone-400">
				{getMessage().AGENTS_CONFIGURATION_DESCRIPTION}
			</p>
			<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
				<ObservabilityBlock
					kind="llm"
					agentKey={agent.agent_key}
					controllerServiceId={agent.controller_service_id}
					enabled={llmView.enabled}
					pending={llmView.transitioning}
					pendingDirection={llmView.direction}
					podSummary={llmView.podSummary}
					onChange={onRefresh}
					serviceName={agent.service_name}
					blockReason={blockReason}
				/>
				<ObservabilityBlock
					kind="agent"
					agentKey={agent.agent_key}
					controllerServiceId={agent.controller_service_id}
					enabled={agentView.enabled}
					pending={agentView.transitioning}
					pendingDirection={agentView.direction}
					podSummary={agentView.podSummary}
					onChange={onRefresh}
					serviceName={agent.service_name}
					blockReason={blockReason}
				/>
			</div>
		</div>
	);
}
