"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CircleDollarSign } from "lucide-react";
import getMessage from "@/constants/messages";
import FeaturePageHeader from "@/components/(playground)/feature-page-header";
import Filter from "@/components/(playground)/filter";
import CostsAnalytics from "@/components/(playground)/costs/costs-analytics";
import CostsConfiguration from "@/components/(playground)/costs/costs-configuration";
import ManageModelsSection from "@/components/(playground)/costs/manage-models-section";

type Tab = "analytics" | "models" | "configuration";

const COSTS_HEADER_TONE =
	"border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-300";

const COSTS_PILL_TAB_ACTIVE =
	"border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200";

function coerceTab(value: string | null): Tab {
	if (value === "configuration") return "configuration";
	if (value === "models") return "models";
	return "analytics";
}

function CostsPillTab({
	active,
	label,
	onClick,
}: {
	active: boolean;
	label: string;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-pressed={active}
			className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-medium transition ${
				active
					? COSTS_PILL_TAB_ACTIVE
					: "border-stone-200 bg-stone-50 text-stone-600 hover:bg-stone-100 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800"
			}`}
		>
			<span>{label}</span>
		</button>
	);
}

export default function CostsPage() {
	const m = getMessage();
	const router = useRouter();
	const searchParams = useSearchParams();
	const [activeTab, setActiveTabState] = useState<Tab>(() =>
		coerceTab(searchParams.get("tab"))
	);

	useEffect(() => {
		setActiveTabState(coerceTab(searchParams.get("tab")));
	}, [searchParams]);

	const setActiveTab = useCallback(
		(tab: Tab) => {
			setActiveTabState(tab);
			const params = new URLSearchParams(window.location.search);
			if (tab === "analytics") {
				params.delete("tab");
			} else {
				params.set("tab", tab);
			}
			const qs = params.toString();
			router.replace(`/costs${qs ? `?${qs}` : ""}`, { scroll: false });
		},
		[router]
	);

	return (
		<div className="flex h-full w-full flex-col overflow-hidden">
			<FeaturePageHeader
				eyebrow={m.SIDEBAR_MONITOR}
				title={m.COSTS_TITLE}
				icon={<CircleDollarSign className="h-4 w-4" />}
				tone={COSTS_HEADER_TONE}
				actions={
					<div className="flex flex-wrap items-center gap-2">
						<CostsPillTab
							active={activeTab === "analytics"}
							label={m.COSTS_TAB_ANALYTICS}
							onClick={() => setActiveTab("analytics")}
						/>
						<CostsPillTab
							active={activeTab === "models"}
							label={m.COSTS_TAB_MODELS}
							onClick={() => setActiveTab("models")}
						/>
						<CostsPillTab
							active={activeTab === "configuration"}
							label={m.COSTS_TAB_CONFIGURATION}
							onClick={() => setActiveTab("configuration")}
						/>
					</div>
				}
			/>

			{activeTab === "analytics" ? (
				<section className="flex min-h-0 flex-1 flex-col overflow-hidden">
					<div className="flex items-center justify-end border-b border-stone-200 px-4 py-2 dark:border-stone-800">
						<Filter />
					</div>
					<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
						<CostsAnalytics onConfigure={() => setActiveTab("configuration")} />
					</div>
				</section>
			) : activeTab === "models" ? (
				<section className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
					<ManageModelsSection />
				</section>
			) : (
				<section className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
					<CostsConfiguration />
				</section>
			)}
		</div>
	);
}
