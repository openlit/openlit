import { DokuParams, DATA_TABLE_NAME, dataCollector } from "./common";

export async function getResultGenerationByEndpoint(params: DokuParams) {
	const { start, end } = params.timeLimit;

	const query = `
    SELECT
      substringIndex(endpoint, '.', 1) AS provider,
      CAST(count(*) AS INTEGER) AS count,
      round(100.0 * count(*) / sum(count(*)) OVER (), 2) AS percentage
    FROM
        ${DATA_TABLE_NAME}
    WHERE
        time >= parseDateTimeBestEffort('${start}') AND time <= parseDateTimeBestEffort('${end}')
    GROUP BY provider;
  `;

	return dataCollector({ query });
}
