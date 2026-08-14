import { getFilterWhereCondition } from "@/helpers/server/platform";
import { MetricParams, dataCollector, OTEL_TRACES_TABLE_NAME } from "../common";
import { getTraceMappingKeyFullPaths } from "@/helpers/server/trace";

function getProviderKeyPath() {
	const paths = (getTraceMappingKeyFullPaths("provider") as string[]).map(
		(path) => `SpanAttributes['${path}']`
	);
	return {
		paths,
		keyPath: paths.reduce(
			(expression, path) =>
				`if(notEmpty(${expression}), ${expression}, ${path})`
		),
	};
}

export async function getResultGenerationByEndpoint(params: MetricParams) {
	const { paths, keyPath } = getProviderKeyPath();
	const query = `
    SELECT 
      ${keyPath} AS provider,
      CAST(COUNT(*) AS INTEGER) AS count
    FROM
        ${OTEL_TRACES_TABLE_NAME}
    WHERE ${getFilterWhereCondition({
			...params,
			notOrEmpty: paths.map((key) => ({ key })),
			operationType: "llm",
		}, true)}
    GROUP BY provider;
  `;

	return dataCollector({ query });
}
