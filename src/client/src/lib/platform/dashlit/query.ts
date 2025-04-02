import { getFilterWhereCondition } from "@/helpers/server/platform";
import { dataCollector, MetricParams, OTEL_TRACES_TABLE_NAME } from "../common";

export async function runQuery({
	query,
	respectFilters,
	params,
}: {
	query: string;
	respectFilters: boolean;
	params: MetricParams;
}) {
	// TODO : sanitize the query
	const filteredQuery = `
  SELECT 
    *
  FROM ${OTEL_TRACES_TABLE_NAME}
  WHERE ${getFilterWhereCondition({
		...params,
	})}`;
	const exactQuery = `${query.replace(
		respectFilters ? /FROM\s+otel_traces/ : "",
		respectFilters ? `FROM ( ${filteredQuery} )` : ""
	)}`;

  console.log(exactQuery, respectFilters, filteredQuery);

	return dataCollector({ query: exactQuery });
}
