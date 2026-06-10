"use client";

/**
 * User-picker dropdown rendered next to the global filter button on
 * the Sessions tab toolbar. Reads/writes the `?user=` URL param so
 * deep-links and the back button round-trip cleanly with the table
 * state.
 *
 * The picker's option set is fetched from
 * `/api/coding-agents/users?limit=50` (vendor-scoped when the agent
 * detail page pins a vendor). The list endpoint already enforces the
 * privacy cohort floor, so `low_cohort` users that come back from the
 * API are filtered client-side here — selecting a masked user
 * wouldn't navigate anywhere useful.
 *
 * F5 / F9 cleanup note: the previous "CodingQuickFilters" default
 * export (a redundant inline filter bar) was removed; this file now
 * holds only the picker that is actually rendered by
 * `<CodingSessionsTab>`.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, User, X } from "lucide-react";

interface CodingUserRow {
	user: string;
	session_count?: number;
}

interface CodingUserPickerProps {
	/** When set, the user list is restricted to this vendor. */
	vendorScope?: string | null;
}

const PICKER_LIMIT = 50;

export function CodingUserPicker({ vendorScope }: CodingUserPickerProps) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const selectedUser = searchParams?.get("user") || "";

	const [open, setOpen] = useState(false);
	const [users, setUsers] = useState<CodingUserRow[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const writeUserParam = useCallback(
		(next: string | null) => {
			const sp = new URLSearchParams(searchParams?.toString() || "");
			if (next) {
				sp.set("user", next);
			} else {
				sp.delete("user");
			}
			const query = sp.toString();
			router.replace(`${pathname}${query ? `?${query}` : ""}`, {
				scroll: false,
			});
		},
		[pathname, router, searchParams]
	);

	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		(async () => {
			setLoading(true);
			setError(null);
			try {
				const url = new URL(
					"/api/coding-agents/users",
					typeof window !== "undefined"
						? window.location.origin
						: "http://localhost"
				);
				url.searchParams.set("limit", String(PICKER_LIMIT));
				if (vendorScope) {
					url.searchParams.set("vendor", vendorScope);
				}
				const res = await fetch(url.toString());
				if (cancelled) return;
				if (!res.ok) {
					setError(`HTTP ${res.status}`);
					setUsers([]);
					return;
				}
				const body = (await res.json()) as {
					data?: CodingUserRow[];
					records?: CodingUserRow[];
				};
				const rows = (body.data || body.records || []).filter(
					(row) =>
						row.user &&
						row.user !== "low_cohort" &&
						row.user !== "unknown"
				);
				setUsers(rows);
			} catch (e) {
				if (!cancelled) {
					setError(String(e));
					setUsers([]);
				}
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [open, vendorScope]);

	const triggerLabel = useMemo(() => {
		if (selectedUser) return selectedUser;
		return "All users";
	}, [selectedUser]);

	return (
		<div className="inline-flex items-center gap-1">
			<DropdownMenu open={open} onOpenChange={setOpen}>
				<DropdownMenuTrigger asChild>
					<Button
						variant="outline"
						size="sm"
						className="h-8 gap-1.5 text-xs font-normal"
					>
						<User className="h-3.5 w-3.5 text-stone-500" />
						<span className="max-w-[180px] truncate">{triggerLabel}</span>
						<ChevronDown className="h-3.5 w-3.5 text-stone-400" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-[260px]">
					<DropdownMenuLabel>Filter by user</DropdownMenuLabel>
					<DropdownMenuSeparator />
					<DropdownMenuCheckboxItem
						checked={!selectedUser}
						onCheckedChange={() => writeUserParam(null)}
					>
						All users
					</DropdownMenuCheckboxItem>
					<DropdownMenuSeparator />
					{loading && (
						<div className="px-2 py-1.5 text-xs text-stone-500">
							Loading…
						</div>
					)}
					{error && (
						<div className="px-2 py-1.5 text-xs text-red-600 dark:text-red-400">
							{error}
						</div>
					)}
					{!loading && !error && users.length === 0 && (
						<div className="px-2 py-1.5 text-xs text-stone-500">
							No users in this window
						</div>
					)}
					{users.map((row) => (
						<DropdownMenuCheckboxItem
							key={row.user}
							checked={selectedUser === row.user}
							onCheckedChange={(checked) =>
								writeUserParam(checked ? row.user : null)
							}
						>
							<div className="flex w-full items-center justify-between gap-2">
								<span className="truncate" title={row.user}>
									{row.user}
								</span>
								{typeof row.session_count === "number" && (
									<span className="text-[10px] text-stone-500 tabular-nums">
										{row.session_count}
									</span>
								)}
							</div>
						</DropdownMenuCheckboxItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
			{selectedUser && (
				<Button
					variant="ghost"
					size="sm"
					className="h-8 w-8 p-0"
					onClick={() => writeUserParam(null)}
					title="Clear user filter"
				>
					<X className="h-3.5 w-3.5" />
				</Button>
			)}
		</div>
	);
}
