import { getTraceMappingKeyFullPath } from "@/helpers/trace";
import { DokuParams, dataCollector, OTEL_TRACES_TABLE_NAME } from "./common";
import { getFilterWhereCondition } from "@/helpers/doku";

export async function getResultGenerationByCategories(params: DokuParams) {
	const query = `SELECT 
    SpanAttributes['${getTraceMappingKeyFullPath("type")}'] AS category,
    CAST(COUNT(*) AS INTEGER) AS count
  FROM ${OTEL_TRACES_TABLE_NAME}
  WHERE ${getFilterWhereCondition(params)}
  GROUP BY category;`;

	return dataCollector({ query });
}
