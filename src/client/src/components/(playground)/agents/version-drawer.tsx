"use client";

import { useCallback, useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatBrowserDateTime } from "@/utils/date";
import getMessage from "@/constants/messages";
import type { AgentVersion } from "@/types/agents";

interface VersionDrawerProps {
	agentKey: string;
	open: boolean;
	onClose: () => void;
	/**
	 * Pre-fetched versions list from the page shell. When provided, we skip
	 * the initial `/api/agents/[key]/versions` round-trip and only call the
	 * API if the user paginates past the initial slice or if the prop is
	 * empty (i.e. the parent doesn't have the data either).
	 */
	initialVersions?: AgentVersion[];
}

/**
 * Initial page size. Larger than the default 50 returned by the API; we
 * still cap the underlying call at the API's hard limit (200). Operators
 * very rarely scroll past the most recent versions, so a deep first page
 * gives best perceived perf without paying for every historical revision.
 */
const PAGE_SIZE = 25;
const HARD_LIMIT = 200;

export default function VersionDrawer({
	agentKey,
	open,
	onClose,
	initialVersions,
}: VersionDrawerProps) {
	const [versions, setVersions] = useState<AgentVersion[]>(
		initialVersions || []
	);
	const [loading, setLoading] = useState(false);
	const [loadingMore, setLoadingMore] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [limit, setLimit] = useState(PAGE_SIZE);
	const [hasMore, setHasMore] = useState(true);

	const fetchVersions = useCallback(
		async (size: number, signal: AbortSignal) => {
			const res = await fetch(`/api/agents/${agentKey}/versions?limit=${size}`, {
				signal,
			});
			if (!res.ok) {
				throw new Error(`HTTP ${res.status}`);
			}
			const body = await res.json();
			return (body.data as AgentVersion[]) || [];
		},
		[agentKey]
	);

	// Keep our local copy in sync with parent-provided versions even when the
	// drawer is closed — that way the user sees the freshest list the moment
	// they open it without a refetch round-trip.
	useEffect(() => {
		if (initialVersions && initialVersions.length > 0) {
			setVersions(initialVersions);
			setHasMore(initialVersions.length >= PAGE_SIZE);
		}
	}, [initialVersions]);

	useEffect(() => {
		if (!open) return;
		// If the parent already pre-fetched and handed us data, skip the
		// drawer-local initial fetch entirely. We'll still call the API on
		// "Load more" past the initial slice.
		if (initialVersions && initialVersions.length > 0) {
			setLimit(Math.max(PAGE_SIZE, initialVersions.length));
			setHasMore(initialVersions.length >= PAGE_SIZE);
			return;
		}
		const controller = new AbortController();
		setLoading(true);
		setError(null);
		setLimit(PAGE_SIZE);
		(async () => {
			try {
				const list = await fetchVersions(PAGE_SIZE, controller.signal);
				if (controller.signal.aborted) return;
				setVersions(list);
				setHasMore(list.length >= PAGE_SIZE);
			} catch (e) {
				if (!controller.signal.aborted) setError(String(e));
			} finally {
				if (!controller.signal.aborted) setLoading(false);
			}
		})();
		return () => controller.abort();
	}, [agentKey, open, fetchVersions, initialVersions]);

	const handleLoadMore = useCallback(async () => {
		const next = Math.min(limit + PAGE_SIZE, HARD_LIMIT);
		setLoadingMore(true);
		try {
			const controller = new AbortController();
			const list = await fetchVersions(next, controller.signal);
			setVersions(list);
			setLimit(next);
			setHasMore(list.length >= next && next < HARD_LIMIT);
		} catch (e) {
			setError(String(e));
		} finally {
			setLoadingMore(false);
		}
	}, [fetchVersions, limit]);

	return (
		<Sheet open={open} onOpenChange={(o) => !o && onClose()}>
			<SheetContent side="right" className="w-full max-w-md sm:max-w-lg overflow-y-auto">
				<SheetHeader>
					<SheetTitle>{getMessage().AGENTS_VERSION_DRAWER_TITLE}</SheetTitle>
				</SheetHeader>
				<div className="mt-4 space-y-3">
					{loading && (
						<div className="text-sm text-stone-500 dark:text-stone-400">
							Loading…
						</div>
					)}
					{error && (
						<div className="text-sm text-red-600 dark:text-red-400">
							{error}
						</div>
					)}
					{!loading && !error && versions.length === 0 && (
						<div className="text-sm text-stone-500 dark:text-stone-400">
							{getMessage().AGENTS_VERSION_NO_HISTORY}
						</div>
					)}
					{versions.map((v, idx) => (
						<div
							key={v.version_hash}
							className="border dark:border-stone-800 rounded-md p-3"
						>
							<div className="flex items-center justify-between gap-2">
								<div className="text-sm font-medium text-stone-900 dark:text-stone-100">
									{getMessage().AGENTS_VERSION_NUMBER_PREFIX}
									{v.version_number}
									{idx === 0 && (
										<span className="ml-2 text-xs text-emerald-600 dark:text-emerald-400">
											{getMessage().AGENTS_VERSION_CURRENT}
										</span>
									)}
								</div>
								<span className="text-xs font-mono text-stone-400">
									{v.version_hash.slice(0, 12)}
								</span>
							</div>
							<dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
								<dt>{getMessage().AGENTS_VERSION_FIRST_SEEN}</dt>
								<dd className="text-stone-700 dark:text-stone-200 text-right">
									{formatBrowserDateTime(v.first_seen)}
								</dd>
								<dt>{getMessage().AGENTS_VERSION_LAST_SEEN}</dt>
								<dd className="text-stone-700 dark:text-stone-200 text-right">
									{formatBrowserDateTime(v.last_seen)}
								</dd>
								<dt>{getMessage().AGENTS_VERSION_REQUESTS}</dt>
								<dd className="text-stone-700 dark:text-stone-200 text-right">
									{v.request_count.toLocaleString()}
								</dd>
								<dt>{getMessage().AGENTS_METADATA_PRIMARY_MODEL}</dt>
								<dd className="text-stone-700 dark:text-stone-200 text-right truncate">
									{v.primary_model || "—"}
								</dd>
							</dl>
						</div>
					))}
					{!loading && hasMore && versions.length > 0 && (
						<button
							type="button"
							onClick={handleLoadMore}
							disabled={loadingMore}
							className="w-full text-xs text-stone-600 dark:text-stone-300 border border-dashed dark:border-stone-700 rounded-md py-2 hover:bg-stone-50 dark:hover:bg-stone-900 disabled:opacity-50"
						>
							{loadingMore
								? getMessage().AGENTS_LOADING_VERSIONS
								: getMessage().AGENTS_LOAD_MORE_VERSIONS}
						</button>
					)}
				</div>
			</SheetContent>
		</Sheet>
	);
}
