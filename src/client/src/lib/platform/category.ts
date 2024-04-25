import { getTraceMappingKeyFullPath } from "@/helpers/trace";
import { MetricParams, dataCollector, OTEL_TRACES_TABLE_NAME } from "./common";
import { getFilterWhereCondition } from "@/helpers/platform";

export async function getResultGenerationByCategories(params: MetricParams) {
	const keyPath = `SpanAttributes['${getTraceMappingKeyFullPath("type")}']`;
	const query = `SELECT 
    ${keyPath} AS category,
    CAST(COUNT(*) AS INTEGER) AS count
  FROM ${OTEL_TRACES_TABLE_NAME}
  WHERE ${getFilterWhereCondition({ ...params, notEmpty: [{ key: keyPath }] })}
  GROUP BY category;`;

	return dataCollector({ query });
}
