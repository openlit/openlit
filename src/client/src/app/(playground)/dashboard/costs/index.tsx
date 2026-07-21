"use client";

import CostsNumberStats from "@/app/(playground)/dashboard/costs/number-stats";
import CostsUsageCharts from "@/app/(playground)/dashboard/costs/usage-charts";
import CostsOptimizationCharts from "@/app/(playground)/dashboard/costs/optimization-charts";
import CostsPerTime from "@/app/(playground)/dashboard/costs/cost-per-time";
import AutoPricingRuns from "@/app/(playground)/dashboard/costs/auto-pricing-runs";
import CostsAutoPricingBanner from "@/components/(playground)/costs/costs-auto-pricing-banner";
import getMessage from "@/constants/messages";

export default function CostsDashboard({
	onConfigure,
}: {
	onConfigure: () => void;
}) {
	const m = getMessage();

	return (
		<div className="flex flex-col gap-6 w-full">
			<CostsAutoPricingBanner onConfigure={onConfigure} />
			<section className="flex flex-col gap-3">
				<h2 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
					{m.COSTS_USAGE_SECTION}
				</h2>
				<CostsNumberStats />
				<CostsUsageCharts />
			</section>
			<section className="flex flex-col gap-3">
				<h2 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
					{m.COSTS_AUTO_PRICING_SECTION}
				</h2>
				<AutoPricingRuns onConfigure={onConfigure} />
			</section>
			<section className="flex flex-col gap-3">
				<h2 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
					{m.COSTS_OPTIMIZATION_SECTION}
				</h2>
				<CostsPerTime />
				<CostsOptimizationCharts />
			</section>
		</div>
	);
}
