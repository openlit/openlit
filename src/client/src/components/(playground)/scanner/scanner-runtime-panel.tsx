"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, Download, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import FeatureAccess from "@/components/rbac/feature-access";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import getMessage from "@/constants/messages";
import { getRequestHeaders } from "@/utils/api";
import type { ScannerRuntimeInfo } from "@/lib/platform/connectors/scanner/types";

export default function ScannerRuntimePanel({
	compact = false,
	onRuntimeChange,
}: {
	compact?: boolean;
	onRuntimeChange?: (runtime: ScannerRuntimeInfo | null) => void;
}) {
	const messages = getMessage();
	const [runtime, setRuntime] = useState<ScannerRuntimeInfo | null>(null);
	const [loading, setLoading] = useState(true);
	const [working, setWorking] = useState(false);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const response = await fetch("/api/scanners/runtime", { headers: getRequestHeaders() });
			const body = await response.json();
			if (!response.ok) throw new Error(body?.err || messages.SCANNER_LOAD_FAILED);
			setRuntime(body.runtime || null);
			onRuntimeChange?.(body.runtime || null);
		} catch {
			setRuntime(null);
			onRuntimeChange?.(null);
		} finally {
			setLoading(false);
		}
	}, [messages.SCANNER_LOAD_FAILED, onRuntimeChange]);

	useEffect(() => {
		void load();
	}, [load]);

	const install = async (upgrade: boolean) => {
		setWorking(true);
		toast.loading(upgrade ? messages.SCANNER_UPGRADE : messages.SCANNER_INSTALL, {
			id: "scanner-install",
		});
		try {
			const response = await fetch("/api/scanners/runtime", {
				method: "POST",
				headers: getRequestHeaders({ "Content-Type": "application/json" }),
				body: JSON.stringify({ upgrade }),
			});
			const body = await response.json();
			if (!response.ok) throw new Error(body?.err || messages.SCANNER_INSTALL_FAILED);
			setRuntime(body.runtime || null);
			onRuntimeChange?.(body.runtime || null);
			toast.success(
				upgrade ? messages.SCANNER_UPGRADE : messages.SCANNER_STATUS_READY,
				{ id: "scanner-install" }
			);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : messages.SCANNER_INSTALL_FAILED, {
				id: "scanner-install",
			});
		} finally {
			setWorking(false);
		}
	};

	const versionLabel = runtime?.installed
		? runtime.version || runtime.binaryVersion
		: messages.SCANNER_VERSION_UNKNOWN;

	return (
		<section
			className={
				compact
					? "shrink-0"
					: "space-y-3 rounded-lg border border-stone-200 p-4 dark:border-stone-800"
			}
		>
			{compact ? (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							variant="outline"
							size="sm"
							className="h-8 max-w-[8.5rem] gap-1 px-2 text-xs"
							aria-label={messages.SCANNER_CLI_MENU}
							disabled={working}
						>
							<span className="truncate">
								{loading ? messages.SCANNER_RUNTIME_CHECKING : versionLabel}
							</span>
							<ChevronDown className="size-3.5 shrink-0 opacity-60" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="w-56">
						<DropdownMenuLabel>{messages.SCANNER_RUNTIME_SECTION}</DropdownMenuLabel>
						<div className="px-2 pb-1.5 text-[11px] text-muted-foreground">
							{messages.SCANNER_VERSION_INSTALLED}: {loading ? messages.SCANNER_RUNTIME_CHECKING : versionLabel}
							{runtime?.latestVersion ? ` · ${messages.SCANNER_VERSION_LATEST} ${runtime.latestVersion}` : ""}
						</div>
						<DropdownMenuSeparator />
						<FeatureAccess access="scanner.install" hideWhenDenied>
							{!runtime?.installed ? (
								<DropdownMenuItem disabled={working || loading} onSelect={() => void install(false)}>
									<Download className="mr-2 size-3.5" />
									{messages.SCANNER_INSTALL}
								</DropdownMenuItem>
							) : null}
							{runtime?.upgradeAvailable ? (
								<DropdownMenuItem disabled={working || loading} onSelect={() => void install(true)}>
									<Download className="mr-2 size-3.5" />
									{runtime.latestVersion
										? messages.SCANNER_UPGRADE_TO(runtime.latestVersion)
										: messages.SCANNER_UPGRADE}
								</DropdownMenuItem>
							) : null}
						</FeatureAccess>
						<DropdownMenuItem disabled={working || loading} onSelect={() => void load()}>
							<RefreshCw className={`mr-2 size-3.5 ${loading ? "animate-spin" : ""}`} />
							{messages.SCANNER_REFRESH}
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			) : (
				<>
					<div>
						<p className="text-xs font-semibold text-stone-950 dark:text-stone-50">
							{messages.SCANNER_RUNTIME_SECTION}
						</p>
						<p className="mt-0.5 text-[11px] text-muted-foreground">
							{messages.SCANNER_RUNTIME_SECTION_DESCRIPTION}
						</p>
						<div className="mt-2 flex flex-wrap items-center gap-2">
							<Badge variant={runtime?.installed ? "secondary" : "outline"} className="text-[10px]">
								{messages.SCANNER_VERSION_INSTALLED}: {loading ? messages.SCANNER_RUNTIME_CHECKING : versionLabel}
							</Badge>
							{runtime?.latestVersion ? (
								<Badge variant="outline" className="text-[10px]">
									{messages.SCANNER_VERSION_LATEST}: {runtime.latestVersion}
								</Badge>
							) : null}
						</div>
					</div>
					<div className="flex flex-wrap items-center gap-1.5">
						<FeatureAccess access="scanner.install" hideWhenDenied>
							{!runtime?.installed ? (
								<Button
									size="sm"
									className="h-8 gap-1.5"
									disabled={working || loading}
									onClick={() => void install(false)}
								>
									<Download className="size-3.5" />
									{messages.SCANNER_INSTALL}
								</Button>
							) : null}
							{runtime?.upgradeAvailable ? (
								<Button
									size="sm"
									className="h-8 gap-1.5"
									disabled={working || loading}
									onClick={() => void install(true)}
								>
									<Download className="size-3.5" />
									{runtime.latestVersion
										? messages.SCANNER_UPGRADE_TO(runtime.latestVersion)
										: messages.SCANNER_UPGRADE}
								</Button>
							) : null}
						</FeatureAccess>
						<Button
							size="sm"
							variant="outline"
							className="h-8 gap-1.5"
							disabled={working || loading}
							title={messages.SCANNER_REFRESH}
							onClick={() => void load()}
						>
							<RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
							{messages.SCANNER_REFRESH}
						</Button>
					</div>
				</>
			)}
		</section>
	);
}
