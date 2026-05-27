"use client";

/**
 * Per-user detail page for coding-agent activity.
 *
 * Just the seeded "Coding Agents" dashboard, pinned to a single
 * developer via `pinnedUser`. No tabs, no extra cards — the user
 * asked for the same overview surface as the main agent page, just
 * scoped, so we deliberately keep this file thin and route everything
 * through `<CodingDashboardTab>`.
 *
 * Layout mirrors the agent-detail page: a full-bleed
 * `flex flex-col w-full h-full overflow-y-auto` shell with a header
 * (Back link + h1 title) above the dashboard. Without this shell the
 * embedded `<Dashboard>` widgets render at parent width only, which
 * looked cramped (~400px) on the per-user page.
 *
 * Data privacy: the digest request honors `COHORT_K_FLOOR`. If the
 * user has fewer than the floor's sessions and the caller is a
 * non-admin viewer, we 404 here (the API returns 404; we render the
 * "not enough activity yet" empty state).
 */

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Loader2, ShieldCheck, Users } from "lucide-react";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import getMessage from "@/constants/messages";
import type { UnifiedAgent } from "@/types/agents";
import { useDynamicBreadcrumbs } from "@/utils/hooks/useBreadcrumbs";

// The dashboard pulls in a heavy widget runtime; lazy-load it so the
// header breadcrumb paints immediately.
const CodingDashboardTab = dynamic(
	() =>
		import(
			"@/components/(playground)/coding-agents/coding-dashboard-tab"
		),
	{
		loading: () => (
			<div className="flex items-center justify-center py-12 text-sm text-stone-500 dark:text-stone-400 gap-2">
				<Loader2 className="w-4 h-4 animate-spin" />
				{getMessage().AGENTS_LOADING_DASHBOARD}
			</div>
		),
		ssr: false,
	}
);

interface UserDigest {
	user: string;
	first_seen: string;
	last_seen: string;
	session_count: number;
	tool_call_count: number;
	cost_usd: number;
	classification_work: number;
	classification_personal: number;
	classification_unknown: number;
	classification_disputed: number;
	top_vendors: Array<{ vendor: string; sessions: number }>;
}

export default function CodingAgentUserPage() {
	// F6: Next 15 changed useParams to return string | string[] — it
	// can't return undefined here because the file is under [userId],
	// but typing it loose lets the same component compile under both
	// 14 and 15 conventions without a cast.
	const params = useParams<{ userId: string | string[] }>();
	const router = useRouter();
	const userId = decodeURIComponent(
		Array.isArray(params?.userId)
			? params.userId[0] || ""
			: params?.userId || ""
	);
	const [digest, setDigest] = useState<UserDigest | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	// F6: register the page in the global breadcrumb trail so the
	// shell's breadcrumbs read "Coding agents → <user>" instead of
	// the raw URL segment. Matches the convention used by the
	// agent detail page (`agents/[agentKey]`).
	useDynamicBreadcrumbs(
		{
			title: digest?.user || userId || "User",
		},
		[digest?.user, userId]
	);

	useEffect(() => {
		if (!userId) return;
		let cancelled = false;
		(async () => {
			setLoading(true);
			setError(null);
			try {
				const res = await fetch(
					`/api/coding-agents/users/${encodeURIComponent(userId)}`
				);
				if (cancelled) return;
				if (res.status === 404) {
					setError("not_found");
					setDigest(null);
					return;
				}
				if (!res.ok) {
					setError(`HTTP ${res.status}`);
					return;
				}
				const body = await res.json();
				setDigest(body.data as UserDigest);
			} catch (e) {
				if (!cancelled) setError(String(e));
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [userId]);

	// The dashboard component requires a UnifiedAgent shape but only
	// uses `coding_agent_vendor` from it — we synthesize the minimum
	// shape here so the embedded board renders without a real agent.
	const stubAgent = {
		coding_agent_vendor: "",
		service_name: userId,
	} as unknown as UnifiedAgent;

	if (loading) {
		return (
			<div className="flex items-center justify-center h-full text-sm text-stone-500 dark:text-stone-400 gap-2">
				<Loader2 className="w-4 h-4 animate-spin" />
				Loading user…
			</div>
		);
	}

	if (error === "not_found") {
		return (
			<div className="p-6 max-w-2xl">
				<Button
					variant="ghost"
					size="sm"
					className="mb-3"
					onClick={() => router.push("/agents?tab=coding")}
				>
					<ArrowLeft className="w-4 h-4 mr-1" /> All coding agents
				</Button>
				<Card>
					<CardHeader>
						<CardTitle className="text-base flex items-center gap-2">
							<ShieldCheck className="w-4 h-4 text-stone-500" />
							No public profile
						</CardTitle>
					</CardHeader>
					<CardContent className="text-sm text-stone-600 dark:text-stone-400">
						<p>
							This user&rsquo;s coding-agent activity is below the
							organisation&rsquo;s privacy cohort floor, so per-user
							detail is not available. The user will appear in the
							directory once they accumulate enough sessions.
						</p>
						<p className="mt-2">
							Org admins can always see raw user activity. Switch to an
							owner/admin role if you need access for incident response.
						</p>
					</CardContent>
				</Card>
			</div>
		);
	}

	if (error) {
		return (
			<div className="p-6">
				<div className="rounded border border-red-200 dark:border-red-900/40 p-4 text-sm text-red-700 dark:text-red-400">
					{error}
				</div>
			</div>
		);
	}

	if (!digest) return null;

	return (
		<div className="flex flex-col w-full h-full gap-5 overflow-y-auto p-1 pb-8">
			<div className="space-y-2">
				<Link
					href="/agents?tab=coding"
					className="inline-flex items-center gap-1.5 text-sm text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100"
				>
					<ArrowLeft className="w-4 h-4" />
					{getMessage().AGENTS_BACK_TO_HUB}
				</Link>
				<h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100 inline-flex items-center gap-2 font-mono">
					<Users className="w-6 h-6 text-violet-500" />
					{digest.user}
				</h1>
			</div>

			<CodingDashboardTab
				agent={stubAgent}
				pinnedUser={digest.user}
				/* The per-user page intentionally renders across all
				   vendors the user has touched — passing
				   `pinnedVendor={null}` tells the dashboard tab to
				   skip the auto-pinned vendor scoping that the
				   per-vendor detail page applies. */
				pinnedVendor={null}
			/>
		</div>
	);
}
