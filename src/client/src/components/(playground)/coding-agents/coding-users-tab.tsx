"use client";

/**
 * Users tab for the coding-agent detail page.
 *
 * Thin shell that pins the vendor filter and renders the shared
 * `ObservabilitySignalList` orchestrator with the `'coding_users'`
 * signal config. Sort options are driven by the registry's
 * `customSortOptions` so they live in the same toolbar dropdown
 * everywhere — see `observability/registry.tsx`.
 *
 * Row click navigates to `/coding-agents/users/[userId]` (handled by
 * the registry's `getDetailHref`); the per-user page embeds the
 * dashboard pinned to that user.
 */

import { useSearchParams } from "next/navigation";
import ObservabilitySignalList from "@/components/(playground)/observability/signal-list";
import { getSignalConfig } from "@/components/(playground)/observability/registry";
import type { UnifiedAgent } from "@/types/agents";

interface CodingUsersTabProps {
	agent: UnifiedAgent;
}

export default function CodingUsersTab({ agent }: CodingUsersTabProps) {
	const searchParams = useSearchParams();
	const pinnedVendor = agent.coding_agent_vendor || null;
	const vendorParam = searchParams?.get("vendor") || pinnedVendor;

	return (
		<ObservabilitySignalList
			config={getSignalConfig("coding_users")}
			runFilters={{ vendor: vendorParam }}
		/>
	);
}
