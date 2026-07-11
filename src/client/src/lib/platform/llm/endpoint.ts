import { getFilterWhereCondition } from "@/helpers/server/platform";
import { MetricParams, dataCollector, OTEL_TRACES_TABLE_NAME } from "../common";
import { getTraceMappingKeyFullPath } from "@/helpers/server/trace";
import { externalGenerationByProvider } from "./external";

export async function getResultGenerationByEndpoint(params: MetricParams) {
	const external = await externalGenerationByProvider(params);
	if (external) return external;

	const keyPath = `SpanAttributes['${getTraceMappingKeyFullPath("provider")}']`;
	const query = `
    SELECT 
      ${keyPath} AS provider,
      CAST(COUNT(*) AS INTEGER) AS count
    FROM
        ${OTEL_TRACES_TABLE_NAME}
    WHERE ${getFilterWhereCondition({
			...params,
			notEmpty: [{ key: keyPath }],
			operationType: "llm",
		}, true)}
    GROUP BY provider;
  `;

	return dataCollector({ query });
}
