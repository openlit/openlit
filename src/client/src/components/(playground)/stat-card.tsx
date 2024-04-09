import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { memo, useCallback, useEffect } from "react";
import Card, { CardProps } from "../common/card";
import { round } from "lodash";
import { getFilterDetails } from "@/selectors/filter";
import { useRootStore } from "@/store";
import { getPingStatus } from "@/selectors/database-config";

type StatCardProps = Partial<CardProps> & {
	dataKey: string;
	extraParams?: Record<any, any>;
	roundTo?: number;
	textPrefix?: string;
	textSuffix?: string;
	url: string;
};

const StatCard = memo(
	({
		dataKey,
		extraParams = {},
		roundTo = 4,
		textClass = "",
		textPrefix = "",
		textSuffix = "",
		url,
		...rest
	}: StatCardProps) => {
		const filter = useRootStore(getFilterDetails);
		const pingStatus = useRootStore(getPingStatus);
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
			if (
				filter.timeLimit.start &&
				filter.timeLimit.end &&
				pingStatus === "success"
			)
				fetchData();
		}, [filter, fetchData, pingStatus]);

		return (
			<Card
				isLoading={(isLoading || !isFetched) || pingStatus === "pending"}
				text={`${textPrefix}${round(
					(data as Record<any, any>)?.[dataKey] || 0,
					roundTo
				)}${textSuffix}`}
				textClass={`text-primary ${textClass}`}
				{...rest}
			/>
		);
	}
);

StatCard.displayName = "StatCard";

export default StatCard;
