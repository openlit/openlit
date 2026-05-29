"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { LayoutDashboard, Loader2, Check, ExternalLink, Download } from "lucide-react";
import { toast } from "sonner";
import getMessage from "@/constants/messages";
import Link from "next/link";

interface DashboardImportCardProps {
	dashboardJson: string;
}

export default function DashboardImportCard({
	dashboardJson,
}: DashboardImportCardProps) {
	const [importing, setImporting] = useState(false);
	const [imported, setImported] = useState(false);
	const [dashboardId, setDashboardId] = useState<string | null>(null);

	let dashboard: any = null;
	try {
		dashboard = JSON.parse(dashboardJson);
	} catch {
		return null;
	}

	if (!dashboard?.title || !dashboard?.widgets) return null;

	const widgetCount = Object.keys(dashboard.widgets).length;

	const handleImport = async () => {
		setImporting(true);
		try {
			const res = await fetch("/api/manage-dashboard/board/layout/import", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: dashboardJson,
			});

			const result = await res.json();

			if (!res.ok || result.error) {
				throw new Error(result.error || "Failed to import dashboard");
			}

			setImported(true);
			const newId = result.data?.id;
			if (newId) setDashboardId(newId);
			toast.success(`Dashboard "${dashboard.title}" imported successfully`);
		} catch (e: any) {
			toast.error(e.message || "Failed to import dashboard");
		} finally {
			setImporting(false);
		}
	};

	return (
		<div className="my-3 rounded-lg border border-stone-200 dark:border-stone-700 overflow-hidden bg-white dark:bg-stone-900">
			{/* Header */}
			<div className="flex items-center gap-3 px-4 py-3 bg-stone-50 dark:bg-stone-800/50 border-b border-stone-200 dark:border-stone-700">
				<div className="flex-shrink-0 p-2 rounded-lg bg-orange-100 dark:bg-orange-950/30">
					<LayoutDashboard className="h-5 w-5 text-orange-600 dark:text-orange-400" />
				</div>
				<div className="flex-1 min-w-0">
					<p className="text-sm font-semibold text-stone-900 dark:text-stone-100">
						{dashboard.title}
					</p>
					<p className="text-xs text-stone-500 dark:text-stone-400">
						{widgetCount} widgets &middot; Ready to import
					</p>
				</div>
			</div>

			{/* Description */}
			{dashboard.description && (
				<div className="px-4 py-2 border-b border-stone-100 dark:border-stone-800">
					<p className="text-xs text-stone-500 dark:text-stone-400">
						{dashboard.description}
					</p>
				</div>
			)}

			{/* Widget preview */}
			<div className="px-4 py-3">
				<div className="flex flex-wrap gap-1.5">
					{Object.values(dashboard.widgets)
						.slice(0, 8)
						.map((widget: any) => (
							<span
								key={widget.id}
								className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300"
							>
								<span className="font-medium">{widget.type?.replace("_", " ")}</span>
								<span className="text-stone-400 dark:text-stone-500">&middot;</span>
								<span className="truncate max-w-[120px]">{widget.title}</span>
							</span>
						))}
					{widgetCount > 8 && (
						<span className="inline-flex items-center px-2 py-1 rounded text-[11px] bg-stone-100 dark:bg-stone-800 text-stone-400">
							+{widgetCount - 8} more
						</span>
					)}
				</div>
			</div>

			{/* Action */}
			<div className="flex items-center gap-2 px-4 py-3 border-t border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800/30">
				{imported ? (
					<div className="flex items-center gap-3">
						<div className="flex items-center gap-2 text-green-600 dark:text-green-400">
							<Check className="h-4 w-4" />
							<span className="text-sm font-medium">Dashboard imported</span>
						</div>
						{dashboardId && (
							<Link href={`/home?dashboardId=${dashboardId}`}>
								<Button variant="outline" size="sm" className="gap-1.5 text-xs">
									Open Dashboard
									<ExternalLink className="h-3 w-3" />
								</Button>
							</Link>
						)}
					</div>
				) : (
					<Button
						onClick={handleImport}
						disabled={importing}
						size="sm"
						className="gap-2"
					>
						{importing ? (
							<Loader2 className="h-4 w-4 animate-spin" />
						) : (
							<LayoutDashboard className="h-4 w-4" />
						)}
						{importing ? "Importing..." : "Import Dashboard"}
					</Button>
				)}
				<Button
					variant="outline"
					size="sm"
					className="gap-1.5 ml-auto"
					onClick={() => {
						const blob = new Blob([dashboardJson], { type: "application/json" });
						const url = URL.createObjectURL(blob);
						const a = document.createElement("a");
						a.href = url;
						a.download = `${(dashboard.title || "dashboard").replace(/\s+/g, "-").toLowerCase()}.json`;
						a.click();
						URL.revokeObjectURL(url);
					}}
				>
					<Download className="h-3.5 w-3.5" />
					Download JSON
				</Button>
			</div>
		</div>
	);
}
