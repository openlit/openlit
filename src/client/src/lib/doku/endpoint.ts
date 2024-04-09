import { getFilterWhereCondition } from "@/helpers/doku";
import { DokuParams, dataCollector, OTEL_TRACES_TABLE_NAME } from "./common";
import { getTraceMappingKeyFullPath } from "@/helpers/trace";

export async function getResultGenerationByEndpoint(params: DokuParams) {
	const query = `
    SELECT
      SpanAttributes['${getTraceMappingKeyFullPath("provider")}'] AS provider,
      CAST(COUNT(*) AS INTEGER) AS count
    FROM
        ${OTEL_TRACES_TABLE_NAME}
    WHERE ${getFilterWhereCondition(params)}
    GROUP BY provider;
  `;

	return dataCollector({ query });
}
