import { DokuParams, TABLE_NAME, dataCollector } from "./common";

export async function getResultGenerationByEndpoint(params: DokuParams) {
	const { start, end } = params.timeLimit;

	const query = `
  SELECT
    SUBSTRING(endpoint FROM '^[^.]+') AS provider,
    CAST(COUNT(*) AS INTEGER) AS count,
    ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER(), 2) AS percentage
  FROM ${TABLE_NAME}
          WHERE time >= '${start}' AND time <= '${end}'
  GROUP BY provider`;

	return dataCollector(query);
}
