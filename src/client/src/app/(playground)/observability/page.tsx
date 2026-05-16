"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ObservabilitySignalList from "@/components/(playground)/observability/signal-list";
import {
	OBSERVABILITY_SIGNALS,
	getSignalConfig,
} from "@/components/(playground)/observability/registry";
import { usePostHog } from "posthog-js/react";
import { stripFilterParams } from "@/helpers/client/filter-persistence";

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
		stripFilterParams(params);
		params.set("tab", value);
		params.delete("selected");
		router.replace(`/observability?${params.toString()}`, { scroll: false });
	};

	return (
		<div className="flex h-full w-full flex-col gap-4 overflow-hidden">
			<section className="rounded-md border border-stone-200 bg-white px-3 py-2 dark:border-stone-800 dark:bg-stone-950">
				<div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
					<div className="min-w-0">
						<div className="flex items-center gap-2">
							<span className={`rounded-md border p-1.5 ${activeConfig.tone}`}>
								<ActiveIcon className="h-4 w-4" />
							</span>
							<div>
								<p className="text-[11px] uppercase tracking-wide text-stone-500 dark:text-stone-400">
									Observability
								</p>
								<h1 className="text-base font-semibold text-stone-950 dark:text-stone-50">
									{activeConfig.label}
								</h1>
							</div>
						</div>
					</div>
					<div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap md:justify-end">
						{OBSERVABILITY_SIGNALS.map((signal) => {
							const Icon = signal.icon;
							const isActive = signal.key === activeConfig.key;
							return (
								<button
									key={signal.key}
									onClick={() => onTabChange(signal.key)}
									className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs transition ${
										isActive
											? signal.tone
											: "border-stone-200 bg-stone-50 text-stone-600 hover:bg-stone-100 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800"
									}`}
								>
									<Icon className="h-4 w-4" />
									<span className="font-medium">{signal.label}</span>
								</button>
							);
						})}
					</div>
				</div>
			</section>
			<section className="min-h-0 flex-1 overflow-auto rounded-md border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-950">
				<ObservabilitySignalList key={activeConfig.key} config={activeConfig} />
			</section>
		</div>
	);
}
