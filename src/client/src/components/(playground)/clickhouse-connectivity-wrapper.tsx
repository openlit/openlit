"use client";
import { pingActiveDatabaseConfig } from "@/helpers/client/database-config";
import { getPingDetails } from "@/selectors/database-config";
import { useRootStore } from "@/store";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { DatabaseZap, ExternalLink, RefreshCw } from "lucide-react";

const ALLOWED_CONNECTIVITY_ALERT = /^\/home$|^\/dashboard$|^\/telemetry(?:\/.*)?$|^\/observability(?:\/.*)?$|^\/requests$|^\/exceptions$|^\/d\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$|^\/prompt-hub$|^\/vault$|^\/dashboards/;

export default function ClickhouseConnectivityWrapper({ children }: { children: React.ReactNode }) {
	const pingDetails = useRootStore(getPingDetails);
	const pathname = usePathname();

	useEffect(() => {
		if (pingDetails.status === "pending") pingActiveDatabaseConfig();
	}, []);

	if (!ALLOWED_CONNECTIVITY_ALERT.test(pathname)) return children;

	return (
		<div className="flex min-h-0 w-full flex-1 flex-col">
			{pingDetails.error ? (
				<div className="mx-4 mt-3 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950 shadow-sm dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100">
					<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
						<DatabaseZap className="h-5 w-5" />
					</div>
					<div className="min-w-0 flex-1">
						<p className="text-sm font-semibold">ClickHouse connector unavailable</p>
						<p className="mt-0.5 text-xs leading-5 text-amber-800 dark:text-amber-200/80">
							External telemetry connectors can still power observability. ClickHouse-backed evaluations and platform features will remain unavailable until a ClickHouse connector is reachable.
						</p>
						<p className="mt-1 truncate text-[11px] text-amber-700/80 dark:text-amber-300/70">{String(pingDetails.error)}</p>
					</div>
					<div className="flex shrink-0 items-center gap-2">
						<button type="button" onClick={() => void pingActiveDatabaseConfig()} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-amber-300 bg-white px-2.5 text-xs font-medium text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-900/60">
							<RefreshCw className="h-3.5 w-3.5" /> Retry
						</button>
						<Link href="/connectors" className="inline-flex h-8 items-center gap-1.5 rounded-md bg-amber-700 px-2.5 text-xs font-medium text-white hover:bg-amber-800 dark:bg-amber-500 dark:text-stone-950 dark:hover:bg-amber-400">
							Manage connectors <ExternalLink className="h-3.5 w-3.5" />
						</Link>
					</div>
				</div>
			) : pingDetails.status === "pending" ? (
				<div className="mx-4 mt-3 flex items-center gap-2 rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-muted-foreground dark:border-stone-800 dark:bg-stone-900/60">
					<RefreshCw className="h-3.5 w-3.5 animate-spin" /> Checking ClickHouse connector…
				</div>
			) : null}
			{children}
		</div>
	);
}
