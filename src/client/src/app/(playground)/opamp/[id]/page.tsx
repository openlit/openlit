"use client";
import { Agent } from "@/types/opamp";
import { AgentDetail } from "../agent";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { useCallback, useEffect } from "react";
import { useParams } from "next/navigation";
import Loader from "@/components/common/loader";
import { usePageHeader } from "@/selectors/page";
import { getAttributeValue } from "@/helpers/client/opamp";

export default function AgentPage() {
	const { fireRequest, data, isLoading } = useFetchWrapper<Agent>();
	const params = useParams();
	const { setHeader } = usePageHeader();
	const agentName = data ? getAttributeValue(data, "Status.agent_description.identifying_attributes", "service.name", "...") : "...";

	const fetchAgentInfo = useCallback(async () => {
		fireRequest({
			requestType: "GET",
			url: `/api/opamp/${params.id}`,
			responseDataKey: "data"
		});
	}, [params.id]);

	useEffect(() => {
		fetchAgentInfo();
	}, [fetchAgentInfo]);

	useEffect(() => {
		setHeader({
			title: "Opamp",
			breadcrumbs: [{
				title: "All agents",
				href: "/opamp"
			}, {
				title: agentName,
			}],
		});
	}, [agentName])

	if (isLoading && !data) return (
		<div className="flex items-center justify-center w-full h-full">
			<Loader />
		</div>
	);

	if (!isLoading && !data) {
		return null;
	}

	return <AgentDetail agent={data!} fetchAgentInfo={fetchAgentInfo} />;
}