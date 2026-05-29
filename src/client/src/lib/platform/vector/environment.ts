import { getTraceMappingKeyFullPath } from "@/helpers/server/trace";
import { MetricParams, OTEL_TRACES_TABLE_NAME, dataCollector } from "../common";
import { getFilterWhereCondition } from "@/helpers/server/platform";

export async function getResultGenerationByEnvironment(params: MetricParams) {
	// See `helpers/server/platform.ts` — environment lives at
	// `ResourceAttributes['deployment.environment']` (OTel standard).
	const keyPathEnvironment = `ResourceAttributes['deployment.environment']`;
	const query = `SELECT 
			DISTINCT ${keyPathEnvironment} as environment, 
      CAST(COUNT(*) AS INTEGER) AS count
		FROM ${OTEL_TRACES_TABLE_NAME} 
		WHERE ${getFilterWhereCondition({
			...params,
			notEmpty: [{ key: keyPathEnvironment }],
			operationType: "vectordb",
		}, true)}
		GROUP BY environment`;

	return dataCollector({ query });
}
