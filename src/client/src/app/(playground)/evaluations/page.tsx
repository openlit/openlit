"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { MonitorCog } from "lucide-react";
import { CLIENT_EVENTS } from "@/constants/events";
import getMessage from "@/constants/messages";
import FeaturePageHeader from "@/components/(playground)/feature-page-header";
import Filter from "@/components/(playground)/filter";
import EvaluationAnalytics from "@/components/(playground)/evaluations/evaluation-analytics";
import EvaluationConfiguration from "@/components/(playground)/evaluations/evaluation-configuration";
import EvaluationTypesSection from "@/components/(playground)/evaluations/evaluation-types-section";

type Tab = "analytics" | "evaluators" | "configuration";

const EVALUATION_HEADER_TONE =
	"border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900/70 dark:bg-orange-950/40 dark:text-orange-300";

const EVALUATION_PILL_TAB_ACTIVE =
	"border-orange-300 bg-orange-50 text-orange-800 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-200";

function coerceTab(value: string | null): Tab {
	if (value === "configuration") return "configuration";
	if (value === "evaluators") return "evaluators";
	return "analytics";
}

function EvaluationPillTab({
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
					? EVALUATION_PILL_TAB_ACTIVE
					: "border-stone-200 bg-stone-50 text-stone-600 hover:bg-stone-100 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800"
			}`}
		>
			<span>{label}</span>
		</button>
	);
}

export default function EvaluationsPage() {
	const m = getMessage();
	const posthog = usePostHog();
	const router = useRouter();
	const searchParams = useSearchParams();
	const [activeTab, setActiveTabState] = useState<Tab>(() =>
		coerceTab(searchParams.get("tab"))
	);

	useEffect(() => {
		posthog?.capture(CLIENT_EVENTS.EVALUATIONS_PAGE_VISITED);
	}, [posthog]);

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
			router.replace(`/evaluations${qs ? `?${qs}` : ""}`, { scroll: false });
		},
		[router]
	);

	return (
		<div className="flex h-full w-full flex-col overflow-hidden">
			<FeaturePageHeader
				eyebrow={m.SIDEBAR_MONITOR}
				title={m.EVALUATION_ENGINE_TITLE}
				icon={<MonitorCog className="h-4 w-4" />}
				tone={EVALUATION_HEADER_TONE}
				actions={
					<div className="flex flex-wrap items-center gap-2">
						<EvaluationPillTab
							active={activeTab === "analytics"}
							label={m.EVALUATION_TAB_ANALYTICS}
							onClick={() => setActiveTab("analytics")}
						/>
						<EvaluationPillTab
							active={activeTab === "evaluators"}
							label={m.EVALUATION_TAB_EVALUATORS}
							onClick={() => setActiveTab("evaluators")}
						/>
						<EvaluationPillTab
							active={activeTab === "configuration"}
							label={m.EVALUATION_TAB_CONFIGURATION}
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
						<EvaluationAnalytics
							onConfigure={() => setActiveTab("configuration")}
						/>
					</div>
				</section>
			) : activeTab === "evaluators" ? (
				<section className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
					<EvaluationTypesSection />
				</section>
			) : (
				<section className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
					<EvaluationConfiguration />
				</section>
			)}
		</div>
	);
}
