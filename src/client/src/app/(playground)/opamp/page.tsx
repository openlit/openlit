"use client";
import { useEffect } from "react";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { Agent } from "@/types/opamp";
import { usePageHeader } from "@/selectors/page";
import List from "./list";

export default function Opamp() {
	const { setHeader } = usePageHeader();
	const { fireRequest, data, isLoading, isFetched } = useFetchWrapper<Agent[]>();

	useEffect(() => {
		setHeader({
			title: "Opamp",
			breadcrumbs: [{
				title: "All agents",
				href: "/opamp"
			}],
		});
		fireRequest({
			requestType: "GET",
			url: `/api/opamp`,
			responseDataKey: "data",
		});
	}, []);

	return <List agents={data || []} isLoading={!data || isLoading} isFetched={isFetched} />;
}