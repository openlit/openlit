"use client";

/**
 * Sessions tab for the coding-agent detail page.
 *
 * After PR #1200 merged the new telemetry primitives (`<ObservabilitySignalList>`
 * + `TraceDetailView` + resizable maximize sheet), this tab is a thin
 * shell that pins the right vendor + optional user filter and lets the
 * shared list/sheet machinery do the rest:
 *   - the list renders via the `'sessions'` signal config
 *   - row click opens the trace detail sheet at the session-root SpanId
 *     (Phase 2 of the coding-agents work made that SpanId stable)
 *   - the sheet has the same maximize handle as `/telemetry`
 *
 * The legacy table + custom session-detail sheet that lived here have
 * been removed; the equivalent transcript / tool / edit drilldowns now
 * live inside the trace hierarchy explorer.
 */

import { useSearchParams } from "next/navigation";
import ObservabilitySignalList from "@/components/(playground)/observability/signal-list";
import { getSignalConfig } from "@/components/(playground)/observability/registry";
import { CodingUserPicker } from "./coding-quick-filters";
import type { UnifiedAgent } from "@/types/agents";

interface CodingSessionsTabProps {
	agent: UnifiedAgent;
}

export default function CodingSessionsTab({ agent }: CodingSessionsTabProps) {
	const searchParams = useSearchParams();
	const pinnedVendor = agent.coding_agent_vendor || null;
	// `?vendor=` overrides the agent-pinned vendor so deep-links from
	// the Coding agents hub still land on the right vendor scope.
	const vendorParam = searchParams?.get("vendor") || pinnedVendor;
	const userParam = searchParams?.get("user") || null;
	// The user picker is rendered as part of the global toolbar (next
	// to the SlidersHorizontal filter button) so it stays in the same
	// visual cluster as the time range / sorting / share controls
	// instead of spawning a second filter bar above the table.
	return (
		<ObservabilitySignalList
			config={getSignalConfig("sessions")}
			runFilters={{
				vendor: vendorParam,
				user: userParam,
			}}
			toolbarExtraControls={
				<CodingUserPicker vendorScope={vendorParam} />
			}
		/>
	);
}
