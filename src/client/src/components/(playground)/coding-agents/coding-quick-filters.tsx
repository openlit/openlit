"use client";

/**
 * User-picker dropdown rendered next to the global filter button on
 * the Sessions tab toolbar. Reads/writes the `?user=` URL param so
 * deep-links and the back button round-trip cleanly with the table
 * state.
 *
 * Fetches via the same POST + OpenLIT context path as the Users tab
 * (`getData` → `/api/coding-agents/users`) so the picker shares the
 * page time window, vendor pin, and env-routed ClickHouse — a bare
 * `fetch` previously missed those headers and defaulted to a 24h GET
 * that often returned an empty set while Sessions still had rows.
 *
 * The list endpoint already enforces the privacy cohort floor, so
 * `low_cohort` / `unknown` rows are skipped client-side — selecting a
 * masked identity wouldn't navigate anywhere useful.
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
import { getData } from "@/utils/api";
import { useRootStore } from "@/store";
import { getFilterDetails } from "@/selectors/filter";

interface CodingUserRow {
	user: string;
	session_count?: number;
}

interface CodingUserPickerProps {
	/** When set, the user list is restricted to this vendor. */
	vendorScope?: string | null;
}

const PICKER_LIMIT = 50;

function isSelectableUser(user: string | undefined): boolean {
	return Boolean(user) && user !== "low_cohort" && user !== "unknown";
}

export function CodingUserPicker({ vendorScope }: CodingUserPickerProps) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const selectedUser = searchParams?.get("user") || "";
	const filter = useRootStore(getFilterDetails);

	const [open, setOpen] = useState(false);
	const [users, setUsers] = useState<CodingUserRow[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [hadMaskedOnly, setHadMaskedOnly] = useState(false);

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
			setHadMaskedOnly(false);
			try {
				const body: Record<string, unknown> = {
					limit: PICKER_LIMIT,
					offset: 0,
					timeLimit: {
						start: filter.timeLimit?.start,
						end: filter.timeLimit?.end,
					},
					sorting: { type: "sessions", direction: "desc" },
					runFilters: {
						...(vendorScope ? { vendor: vendorScope } : {}),
					},
				};
				const response = (await getData({
					url: "/api/coding-agents/users",
					method: "POST",
					body: JSON.stringify(body),
				})) as {
					data?: CodingUserRow[];
					records?: CodingUserRow[];
					err?: string;
					error?: string;
				};
				if (cancelled) return;
				if (response?.err || response?.error) {
					setError(String(response.err || response.error));
					setUsers([]);
					return;
				}
				const raw = response.data || response.records || [];
				const rows = raw.filter((row) => isSelectableUser(row.user));
				setHadMaskedOnly(raw.length > 0 && rows.length === 0);
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
	}, [
		open,
		vendorScope,
		filter.timeLimit?.start,
		filter.timeLimit?.end,
	]);

	const triggerLabel = useMemo(() => {
		if (selectedUser) return selectedUser;
		return "All users";
	}, [selectedUser]);

	const emptyLabel = hadMaskedOnly
		? "No identifiable users in this window"
		: "No users in this window";

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
							{emptyLabel}
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
