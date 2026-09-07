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
import { fetchProjectList } from "@/helpers/client/project";
import { useProjectDatabaseSetup } from "@/utils/hooks/use-project-database-setup";
import Loader from "@/components/common/loader";

export default function ChatPage() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const conversationId = searchParams.get("id");
	const initialPrompt = searchParams.get("prompt");
	const currentOrg = useRootStore(getCurrentOrganisation);
	const projects = useRootStore(getProjectList);
	const currentProject = useRootStore(getCurrentProject);
	const isProjectLoading = useRootStore(getProjectIsLoading);
	const { hasDbConfig, isDatabaseSetupLoading } = useProjectDatabaseSetup();
	const hasProject = Boolean(currentProject?.id && (projects?.length || 0) > 0);
	const isSetupLoading =
		isProjectLoading ||
		isDatabaseSetupLoading ||
		projects === undefined;

	useEffect(() => {
		if (currentOrg?.id) fetchProjectList(currentOrg.id);
	}, [currentOrg?.id]);

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
				<ChatLayout initialConversationId={conversationId} initialPrompt={initialPrompt} />
			</div>
		</RequestProvider>
	);
}
