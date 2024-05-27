import { getFilterWhereCondition } from "@/helpers/platform";
import { MetricParams, dataCollector, OTEL_TRACES_TABLE_NAME } from "./common";
import { getTraceMappingKeyFullPath } from "@/helpers/trace";

export async function getResultGenerationByEndpoint(params: MetricParams) {
	const keyPaths = [
		{ key: `SpanAttributes['${getTraceMappingKeyFullPath("system")}']` },
		{ key: `SpanAttributes['${getTraceMappingKeyFullPath("provider")}']` },
	];
	const query = `
    SELECT
      CASE
          WHEN notEmpty(SpanAttributes['${getTraceMappingKeyFullPath(
						"provider"
					)}'])
          THEN SpanAttributes['${getTraceMappingKeyFullPath("provider")}']
          ELSE SpanAttributes['${getTraceMappingKeyFullPath("system")}']
      END AS provider,
      CAST(COUNT(*) AS INTEGER) AS count
    FROM
        ${OTEL_TRACES_TABLE_NAME}
    WHERE ${getFilterWhereCondition({
			...params,
			notOrEmpty: keyPaths,
		})}
    GROUP BY provider;
  `;

	return dataCollector({ query });
}
