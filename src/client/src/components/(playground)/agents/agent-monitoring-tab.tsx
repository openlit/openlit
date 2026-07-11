"use client";

import { useState } from "react";
import ObservabilitySignalList from "@/components/(playground)/observability/signal-list";
import {
	OBSERVABILITY_SIGNALS,
	getSignalConfig,
} from "@/components/(playground)/observability/registry";
import { prepareObservabilitySignalChange } from "@/helpers/client/observability";
import { getUpdateConfig, getUpdateFilter } from "@/selectors/filter";
import { useRootStore } from "@/store";

/**
 * Agent Monitoring tab. Mirrors the Telemetry page's multi-signal browser
 * (Traces / Exceptions / Metrics / Logs) but stays scoped to the current
 * agent: the surrounding `AgentScopeProvider` locks `selectedConfig`
 * (serviceNames / environments / versionFilter), so every signal list here is
 * automatically filtered to this agent's service. Coding-only signals are
 * hidden — they live under the coding-agent hub.
 */
export default function AgentMonitoringTab() {
	const updateConfig = useRootStore(getUpdateConfig);
	const updateFilter = useRootStore(getUpdateFilter);
	const [activeKey, setActiveKey] = useState("traces");
	const activeConfig = getSignalConfig(activeKey);

	const signals = OBSERVABILITY_SIGNALS.filter(
		(signal) => signal.key !== "sessions" && signal.key !== "coding_users"
	);

	const onTabChange = (key: string) => {
		if (key === activeKey) return;
		// Reset sort / groupBy / pagination so a trace column can't leak into
		// the metrics or logs query. Scope fields (serviceNames) are untouched
		// and re-asserted by AgentScopeProvider.
		prepareObservabilitySignalChange(updateConfig, updateFilter);
		setActiveKey(key);
	};

	return (
		<div className="flex flex-col gap-3">
			<div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
				{signals.map((signal) => {
					const Icon = signal.icon;
					const isActive = signal.key === activeConfig.key;
					return (
						<button
							key={signal.key}
							onClick={() => onTabChange(signal.key)}
							className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs transition ${
								isActive
									? signal.tone
									: "border-stone-200 bg-stone-50 text-stone-600 hover:bg-stone-100 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800"
							}`}
						>
							<Icon className="h-4 w-4" />
							<span className="font-medium">{signal.label}</span>
						</button>
					);
				})}
			</div>
			<ObservabilitySignalList key={activeConfig.key} config={activeConfig} />
		</div>
	);
}
