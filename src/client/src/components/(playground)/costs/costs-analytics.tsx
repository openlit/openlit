"use client";

import CostsDashboard from "@/app/(playground)/dashboard/costs";

export default function CostsAnalytics({
	onConfigure,
}: {
	onConfigure: () => void;
}) {
	return <CostsDashboard onConfigure={onConfigure} />;
}
