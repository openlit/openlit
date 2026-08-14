"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ChatLayout from "@/components/(playground)/chat/chat-layout";
import { RequestProvider } from "@/components/(playground)/request/request-context";
import { useRootStore } from "@/store";
import { getCurrentOrganisation } from "@/selectors/organisation";
import {
	getCurrentProject,
	getProjectIsLoading,
	getProjectList,
} from "@/selectors/project";
import {
	getDatabaseConfigList,
	getDatabaseConfigListIsLoading,
} from "@/selectors/database-config";
import { fetchProjectList } from "@/helpers/client/project";
import { fetchDatabaseConfigList } from "@/helpers/client/database-config";
import Loader from "@/components/common/loader";

export default function ChatPage() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const conversationId = searchParams.get("id");
	const currentOrg = useRootStore(getCurrentOrganisation);
	const projects = useRootStore(getProjectList);
	const currentProject = useRootStore(getCurrentProject);
	const isProjectLoading = useRootStore(getProjectIsLoading);
	const databaseConfigs = useRootStore(getDatabaseConfigList);
	const isDatabaseConfigLoading = useRootStore(getDatabaseConfigListIsLoading);
	const hasProject = Boolean(currentProject?.id && (projects?.length || 0) > 0);
	const hasDbConfig = Boolean(databaseConfigs?.length);
	const isSetupLoading =
		isProjectLoading ||
		isDatabaseConfigLoading ||
		projects === undefined ||
		(hasProject && databaseConfigs === undefined);

	useEffect(() => {
		if (currentOrg?.id) fetchProjectList(currentOrg.id);
	}, [currentOrg?.id]);

	useEffect(() => {
		if (currentProject?.id) fetchDatabaseConfigList(() => {});
	}, [currentProject?.id]);

	useEffect(() => {
		if (!isSetupLoading && (!currentOrg?.id || !hasProject || !hasDbConfig)) {
			router.replace("/onboarding");
		}
	}, [currentOrg?.id, hasDbConfig, hasProject, isSetupLoading, router]);

	if (isSetupLoading || !hasProject || !hasDbConfig) {
		return (
			<div className="flex h-full w-full items-center justify-center">
				<Loader />
			</div>
		);
	}

	return (
		<RequestProvider>
			<div className="flex flex-col w-full h-full overflow-hidden">
				<ChatLayout initialConversationId={conversationId} />
			</div>
		</RequestProvider>
	);
}
