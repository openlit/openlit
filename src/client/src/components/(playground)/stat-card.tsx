import { useFilter } from "@/app/(playground)/filter-context";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { memo, useCallback, useEffect } from "react";
import Card, { CardProps } from "../common/card";
import { round } from "lodash";

type StatCardProps = Partial<CardProps> & {
	dataKey: string;
	extraParams?: Record<any, any>;
	textPrefix?: string;
	textSuffix?: string;
	url: string;
};

const StatCard = memo(
	({
		dataKey,
		extraParams = {},
		textClass = "",
		textPrefix = "",
		textSuffix = "",
		url,
		...rest
	}: StatCardProps) => {
		const [filter] = useFilter();
		const { data, isFetched, isLoading, fireRequest } = useFetchWrapper();

		const fetchData = useCallback(async () => {
			fireRequest({
				body: JSON.stringify({
					timeLimit: filter.timeLimit,
					...extraParams,
				}),
				requestType: "POST",
				url,
				responseDataKey: "data[0]",
			});
		}, [filter, url]);

		useEffect(() => {
			if (filter.timeLimit.start && filter.timeLimit.end) fetchData();
		}, [filter, fetchData]);

		return (
			<Card
				isLoading={isLoading || !isFetched}
				text={`${textPrefix}${round(
					(data as Record<any, any>)?.[dataKey] || 0,
					4
				)}${textSuffix}`}
				textClass={`text-primary ${textClass}`}
				{...rest}
			/>
		);
	}
);

StatCard.displayName = "StatCard";

export default StatCard;
