import { GENERATION_CATEGORIZATION } from "@/utils/generation";
import { DokuParams, DATA_TABLE_NAME, dataCollector } from "./common";

export async function getResultGenerationByCategories(params: DokuParams) {
	const { start, end } = params.timeLimit;

	const query = `SELECT 
  category,
  arrayStringConcat(arrayDistinct(groupArray(endpoint)), ', ') AS endpoints,
  CAST(COUNT(*) AS INTEGER) AS count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) AS percentage
FROM 
  (
      SELECT 
          CASE
              WHEN endpoint LIKE 'openai.chat%' THEN '${GENERATION_CATEGORIZATION.chat}'
              WHEN endpoint LIKE 'openai.completions%' THEN '${GENERATION_CATEGORIZATION.chat}'
              WHEN endpoint LIKE 'anthropic.completions%' THEN '${GENERATION_CATEGORIZATION.chat}'
              WHEN endpoint LIKE 'cohere.summarize%' THEN '${GENERATION_CATEGORIZATION.chat}'
              WHEN endpoint LIKE 'cohere.generate%' THEN '${GENERATION_CATEGORIZATION.chat}'
              WHEN endpoint LIKE 'cohere.chat%' THEN '${GENERATION_CATEGORIZATION.chat}'
              WHEN endpoint LIKE '%embed%' THEN '${GENERATION_CATEGORIZATION.embed}'
              WHEN endpoint LIKE 'openai.images%' THEN '${GENERATION_CATEGORIZATION.image}'
              WHEN endpoint LIKE 'openai.audio%' THEN '${GENERATION_CATEGORIZATION.audio}'
              WHEN endpoint LIKE 'openai.fine_tuning%' THEN '${GENERATION_CATEGORIZATION.finetune}'
          END AS category,
          endpoint
      FROM ${DATA_TABLE_NAME}
      WHERE time >= parseDateTimeBestEffort('${start}') AND time <= parseDateTimeBestEffort('${end}')
  ) AS subquery
GROUP BY 
  category;

    `;

	return dataCollector({ query });
}
