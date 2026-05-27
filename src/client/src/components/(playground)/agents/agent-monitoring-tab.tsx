"use client";

import ObservabilitySignalList from "@/components/(playground)/observability/signal-list";
import { getSignalConfig } from "@/components/(playground)/observability/registry";

export default function AgentMonitoringTab() {
	return <ObservabilitySignalList config={getSignalConfig("traces")} />;
}
