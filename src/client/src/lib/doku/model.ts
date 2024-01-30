import { DokuParams, TABLE_NAME, dataCollector } from "./common";

export type ModelDokuParams = DokuParams & {
	top: number;
};

export async function getTopModels(params: ModelDokuParams) {
	const { start, end } = params.timeLimit;

	const query = `
    SELECT model, CAST(COUNT(model) AS DECIMAL) AS model_count
    FROM ${TABLE_NAME} 
    WHERE time >= '${start}' AND time <= '${end}'
    GROUP BY model
    ORDER BY model_count DESC
    LIMIT ${params.top}`;

	return dataCollector(query);
}
