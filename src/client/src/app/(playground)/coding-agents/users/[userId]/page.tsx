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

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Loader2, ShieldCheck } from "lucide-react";
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
import { useFilters } from "@/selectors/filter";

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
	// Code-impact rollups returned by getCodingUserDigest. Mirrors
	// CodingUserDigest from the platform queries module.
	lines_added: number;
	lines_removed: number;
	lines_accepted: number;
	lines_rejected: number;
	edit_accept_count: number;
	edit_reject_count: number;
	acceptance_pct: number;
	commit_count: number;
	pr_count: number;
}

export default function CodingAgentUserPage() {
	// F6: Next 15 changed useParams to return string | string[] — it
	// can't return undefined here because the file is under [userId],
	// but typing it loose lets the same component compile under both
	// 14 and 15 conventions without a cast.
	const params = useParams<{ userId: string | string[] }>();
	const router = useRouter();
	const searchParams = useSearchParams();
	const userId = decodeURIComponent(
		Array.isArray(params?.userId)
			? params.userId[0] || ""
			: params?.userId || ""
	);
	// The signal-list row-click handler stamps the originating
	// pathname+search on `?from=`, so a click from the per-vendor
	// detail page's Users tab gives us e.g.
	// `/agents/<key>?tab=users`. We send the user back there if
	// present; otherwise fall back to the global Coding Agents tab.
	// The value is already URL-encoded by `getDetailHref`, so we
	// decode once before passing to `<Link href>` (Next will
	// re-encode safely).
	const fromParam = searchParams?.get("from") || "";
	const decodedFrom = fromParam ? decodeURIComponent(fromParam) : "";
	const backHref = decodedFrom || "/agents?tab=coding";
	// Pull the originating agent_key out of the `from` URL so we can
	// scope the embedded dashboard to whichever vendor's Users tab
	// the operator clicked through from. Shape: `/agents/<key>?…`.
	// We don't try to reverse computeAgentKey — it's hashed and
	// opaque — we resolve key → vendor via the agent API instead.
	const originAgentKey = useMemo(() => {
		if (!decodedFrom) return "";
		const match = decodedFrom.match(/^\/agents\/([^/?#]+)/);
		return match ? decodeURIComponent(match[1]) : "";
	}, [decodedFrom]);

	const [digest, setDigest] = useState<UserDigest | null>(null);
	const [originVendor, setOriginVendor] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	// All coding-agent surfaces in OpenLit follow the global time
	// range from the filter picker — there is no fixed 24h fallback
	// on this page. We forward `since`/`until` to the digest API so
	// the Code Impact stat row above the dashboard moves in lockstep
	// with the widgets in `<CodingDashboardTab>` (which already reads
	// from the same store via `useFilters`).
	const { details: filter } = useFilters();
	const sinceISO = useMemo(
		() => filter.timeLimit?.start?.toISOString() ?? "",
		[filter.timeLimit?.start]
	);
	const untilISO = useMemo(
		() => filter.timeLimit?.end?.toISOString() ?? "",
		[filter.timeLimit?.end]
	);

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
				const qs = new URLSearchParams();
				if (sinceISO) qs.set("since", sinceISO);
				if (untilISO) qs.set("until", untilISO);
				const url = `/api/coding-agents/users/${encodeURIComponent(userId)}${
					qs.toString() ? `?${qs.toString()}` : ""
				}`;
				const res = await fetch(url);
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
	}, [userId, sinceISO, untilISO]);

	// Resolve the origin agent_key into the vendor we should scope
	// the dashboard to. We deliberately do this on a separate fetch
	// (not piggybacked on the digest) because the digest is keyed by
	// user, not vendor — only the originating page knows which
	// coding tool's Users tab the operator was viewing. A failed
	// lookup just falls back to the cross-vendor view, which is
	// what the page did before this scoping was added.
	useEffect(() => {
		if (!originAgentKey) {
			setOriginVendor(null);
			return;
		}
		let cancelled = false;
		(async () => {
			try {
				const res = await fetch(
					`/api/agents/${encodeURIComponent(originAgentKey)}`,
				);
				if (!res.ok) return;
				const body = (await res.json()) as {
					data?: { coding_agent_vendor?: string };
				};
				if (cancelled) return;
				const vendor = body?.data?.coding_agent_vendor;
				if (vendor) setOriginVendor(vendor);
			} catch {
				// Best-effort. The dashboard renders cross-vendor when
				// we can't resolve the originating vendor.
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [originAgentKey]);

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
				{/* Back button + email styled to match the trace
				    full-view header (see trace-detail-page.tsx).
				    Button is the standard `outline`/`sm` 32×32
				    square; the email below it is plain mono text
				    with no leading icon. Target is the Users tab
				    the user clicked through from — we read it off
				    `?from=` (signal-list stamps the full
				    originating pathname+search there) and fall
				    back to the global Coding Agents tab when the
				    user landed via a deep link without that
				    context. */}
				<Button
					variant="outline"
					size="sm"
					onClick={() => router.push(backHref)}
					className="h-8 w-8 p-0"
					title={getMessage().AGENTS_BACK_TO_HUB}
					aria-label={getMessage().AGENTS_BACK_TO_HUB}
				>
					<ArrowLeft className="h-3.5 w-3.5" />
				</Button>
				<h1 className="text-sm font-medium text-stone-900 dark:text-stone-100 font-mono">
					{digest.user}
				</h1>
			</div>

			<CodingDashboardTab
				agent={stubAgent}
				pinnedUser={digest.user}
				/* Scope to the vendor whose Users tab the operator
				   clicked through from (recovered above by parsing
				   `?from=` and resolving the agent_key → vendor).
				   If the page was opened via a deep link with no
				   `from` context — or the agent lookup failed — we
				   pass `null` to keep the legacy cross-vendor view
				   instead of pinning to an arbitrary one. */
				pinnedVendor={originVendor}
			/>
		</div>
	);
}
