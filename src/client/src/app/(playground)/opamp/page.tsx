"use client";
import { useEffect } from "react";
import { HealthMonitor } from "./health-monitor";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { Agent } from "@/types/opamp";
import { usePageHeader } from "@/selectors/page";

export default function Opamp() {
	const { setHeader } = usePageHeader();
	const { fireRequest, data, isLoading } = useFetchWrapper<Agent[]>();

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

	return <HealthMonitor agents={data || []} isLoading={!data || isLoading} />;
}