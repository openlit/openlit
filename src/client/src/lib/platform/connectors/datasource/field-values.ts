import type { MetricParams } from "@/lib/platform/common";
import { metricParamsToOpenLITQuery } from "@/lib/platform/connectors/datasource/clickhouse/query-map";
import { facadeErrorMessage, resolveSignalReadContext } from "@/lib/platform/connectors/datasource/facade";
import { planAndDistinctValues } from "@/lib/platform/connectors/datasource/query-planner";
import type { Signal } from "@/lib/platform/connectors/datasource/types";

/**
 * Common datasource-routed field-value lookup used by query builders.
 * The selected signal binding is resolved exactly like list/summary reads.
 */
export async function getSignalFieldValues(
	signal: Exclude<Signal, "intelligence">,
	field: string,
	params: MetricParams
) {
	try {
		const { adapter } = await resolveSignalReadContext(signal, params);
		const query = metricParamsToOpenLITQuery(params, signal);
		const values = await planAndDistinctValues(adapter, field, query);
		return {
			err: null,
			values: Array.from(new Set(values.map(String).filter(Boolean)))
				.sort((a, b) => a.localeCompare(b))
				.slice(0, 100),
		};
	} catch (error) {
		return { err: facadeErrorMessage(error), values: [] as string[] };
	}
}
