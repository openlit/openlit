"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ObservabilitySignalList from "@/components/(playground)/observability/signal-list";
import {
	OBSERVABILITY_SIGNALS,
	getSignalConfig,
} from "@/components/(playground)/observability/registry";
import { usePostHog } from "posthog-js/react";

export default function ObservabilityPage() {
	const searchParams = useSearchParams();
	const router = useRouter();
	const posthog = usePostHog();
	const activeTab = searchParams.get("tab") || "traces";
	const activeConfig = getSignalConfig(activeTab);
	const ActiveIcon = activeConfig.icon;

	useEffect(() => {
		posthog?.capture("OBSERVABILITY_PAGE_VISITED", {
			tab: activeConfig.key,
		});
	}, [activeConfig.key, posthog]);

	const onTabChange = (value: string) => {
		const params = new URLSearchParams(searchParams.toString());
		params.set("tab", value);
		params.delete("gb");
		params.delete("gbv");
		router.replace(`/observability?${params.toString()}`, { scroll: false });
	};

	return (
		<div className="flex flex-col w-full h-full gap-4">
			<div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4 min-h-0 grow">
				<aside className="flex flex-col gap-2 rounded-md border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 p-2 overflow-auto">
					<div className="px-2 py-1.5">
						<p className="text-xs uppercase tracking-wide text-stone-400 dark:text-stone-500">
							Observability
						</p>
						<h1 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
							Signal Explorer
						</h1>
					</div>
					<div className="grid gap-2">
						{OBSERVABILITY_SIGNALS.map((signal) => {
							const Icon = signal.icon;
							const isActive = signal.key === activeConfig.key;
							return (
								<button
									key={signal.key}
									onClick={() => onTabChange(signal.key)}
									className={`group flex items-start gap-3 rounded-md border p-3 text-left transition-colors ${
										isActive
											? signal.tone
											: "border-transparent bg-stone-50 text-stone-600 hover:border-stone-200 hover:bg-stone-100 dark:bg-stone-900 dark:text-stone-300 dark:hover:border-stone-800 dark:hover:bg-stone-800"
									}`}
								>
									<span className={`rounded-md border p-2 ${isActive ? "border-current bg-white/70 dark:bg-stone-950/50" : "border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950"}`}>
										<Icon className="h-4 w-4" />
									</span>
									<span className="min-w-0">
										<span className="block text-sm font-semibold text-stone-900 dark:text-stone-100">
											{signal.label}
										</span>
										<span className="mt-0.5 block truncate text-xs text-stone-500 dark:text-stone-400">
											{signal.shortLabel}
										</span>
									</span>
								</button>
							);
						})}
					</div>
					<div className={`mt-auto rounded-md border p-3 ${activeConfig.tone}`}>
						<p className="text-xs uppercase tracking-wide opacity-80">
							Current View
						</p>
						<div className="mt-1 flex items-center gap-2">
							<ActiveIcon className="h-4 w-4" />
							<span className="text-sm font-semibold">{activeConfig.summary}</span>
						</div>
					</div>
				</aside>
				<section className="flex min-w-0 flex-col rounded-md border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 p-4">
					<ObservabilitySignalList config={activeConfig} />
				</section>
			</div>
		</div>
	);
}
