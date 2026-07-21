import { dataCollector, MetricParams, OTEL_TRACES_TABLE_NAME } from "@/lib/platform/common";
import { getFilterWhereCondition } from "@/helpers/server/platform";
import { getTraceMappingKeyFullPath } from "@/helpers/server/trace";
import { getPricingConfig } from "@/lib/platform/pricing/config";

export type CostPricingGuidance = {
	autoEnabled: boolean;
	missingCostSpans: number;
	showBackfillBanner: boolean;
};

export async function getCostPricingGuidance(
	params: MetricParams
): Promise<CostPricingGuidance> {
	const config = await getPricingConfig();
	const autoEnabled = !!config?.auto;

	const costKeyPath = `SpanAttributes['${getTraceMappingKeyFullPath("cost")}']`;
	const query = `
		SELECT
			CAST(count() AS INTEGER) AS missing_cost_spans
		FROM ${OTEL_TRACES_TABLE_NAME}
		WHERE ${getFilterWhereCondition(
			{
				...params,
				operationType: "llm",
			},
			true
		)}
			AND (${costKeyPath} = '' OR toFloat64OrZero(${costKeyPath}) = 0)
	`;

	const { data, err } = await dataCollector({ query });
	const row = Array.isArray(data) ? data[0] : undefined;
	const missingCostSpans =
		err || !row ? 0 : Number(row.missing_cost_spans) || 0;

	return {
		autoEnabled,
		missingCostSpans,
		showBackfillBanner: !autoEnabled && missingCostSpans > 0,
	};
}
