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
 */
export default function AgentConfigurationTab({
	agent,
	onRefresh,
}: AgentConfigurationTabProps) {
	const llmIntent = useAgentIntent(agent.agent_key, "llm");
	const agentIntent = useAgentIntent(agent.agent_key, "agent");
	const llmView = getObservabilityView(agent, "llm", llmIntent);
	const agentView = getObservabilityView(agent, "agent", agentIntent);

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
				/>
			</div>
		</div>
	);
}
