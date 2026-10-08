"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import getMessage from "@/constants/messages";
import { useRootStore } from "@/store";
import { getCurrentProject, getCurrentProjectEnvironment } from "@/selectors/project";
import { getData } from "@/utils/api";
import type { RealtimeFindingView } from "@/lib/platform/realtime/types";

const POLL_MS = 15_000;
const LIMIT = 20;

const SEVERITY_CLASSES: Record<string, string> = {
	critical: "border-red-200 bg-red-50 text-red-700 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300",
	warning: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-300",
	info: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/70 dark:bg-sky-950/40 dark:text-sky-300",
};

function scopeLabel(group: Record<string, string>): string {
	const entries = Object.entries(group || {});
	return entries.length ? entries.map(([key, value]) => `${key}: ${value}`).join(" · ") : "";
}

export default function SignalAlertsButton() {
	const m = getMessage();
	const project = useRootStore(getCurrentProject);
	const environment = useRootStore(getCurrentProjectEnvironment) || "production";
	const [findings, setFindings] = useState<RealtimeFindingView[]>([]);
	const [open, setOpen] = useState(false);

	const load = useCallback(async () => {
		if (!project?.id) {
			setFindings([]);
			return;
		}
		try {
			const params = new URLSearchParams({ environment, state: "firing", limit: String(LIMIT) });
			const res = await getData({ url: `/api/realtime/findings?${params}`, method: "GET" });
			setFindings(Array.isArray(res?.findings) ? res.findings : []);
		} catch {
			setFindings([]);
		}
	}, [project?.id, environment]);

	useEffect(() => {
		load();
		const timer = setInterval(load, POLL_MS);
		return () => clearInterval(timer);
	}, [load]);

	const count = findings.length;
	const button = (
		<button
			type="button"
			aria-label={m.REALTIME_ALERTS_LABEL}
			className="relative inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-stone-200 bg-white text-stone-700 shadow-sm transition-colors hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800"
		>
			<Bell className="size-3.5" />
			{count > 0 ? (
				<span className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-none text-white">
					{count >= LIMIT ? `${LIMIT}+` : count}
				</span>
			) : null}
		</button>
	);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>{button}</PopoverTrigger>
			<PopoverContent align="end" className="w-80 p-0">
				<div className="border-b border-stone-200 px-3 py-2 text-xs font-medium text-stone-800 dark:border-stone-800 dark:text-stone-100">
					{m.REALTIME_ALERTS_LABEL}
				</div>
				{count === 0 ? (
					<p className="px-3 py-4 text-xs text-stone-500 dark:text-stone-400">{m.REALTIME_ALERTS_EMPTY}</p>
				) : (
					<ul className="max-h-80 overflow-y-auto">
						{findings.slice(0, 8).map((finding) => (
							<li key={finding.id} className="border-b border-stone-100 px-3 py-2 last:border-0 dark:border-stone-800">
								<div className="flex items-center gap-2">
									<span className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-medium ${SEVERITY_CLASSES[finding.severity] || SEVERITY_CLASSES.info}`}>
										{finding.severity}
									</span>
									<span className="min-w-0 truncate text-xs font-medium text-stone-900 dark:text-stone-50">
										{finding.ruleName}
									</span>
								</div>
								<p className="mt-1 truncate text-[11px] text-stone-500 dark:text-stone-400">
									{scopeLabel(finding.group) || finding.environment}
								</p>
							</li>
						))}
					</ul>
				)}
				<Link
					href="/realtime?view=findings"
					onClick={() => setOpen(false)}
					className="block border-t border-stone-200 px-3 py-2 text-xs font-medium text-stone-700 hover:bg-stone-50 dark:border-stone-800 dark:text-stone-200 dark:hover:bg-stone-900"
				>
					{m.REALTIME_ALERTS_VIEW}
				</Link>
			</PopoverContent>
		</Popover>
	);
}
