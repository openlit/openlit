"use client";
import ApiReference from "@/components/(playground)/api-keys/api-reference";
import FeaturePageHeader from "@/components/(playground)/feature-page-header";
import getMessage from "@/constants/messages";
import { ApiKey } from "@/types/api-key";
import { BookText } from "lucide-react";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import OpenLitContextIds from "@/components/(playground)/openlit-context-ids";

export default function OpenApiPage() {
	const messages = getMessage();
	const { data } = useFetchWrapper<ApiKey[]>();

	const userApiKey = data && data.length > 0 ? data[0].apiKey : undefined;

	return (
		<div className="flex flex-col grow w-full h-full overflow-hidden">
			<FeaturePageHeader
				eyebrow={messages.AUTH_DOCUMENTATION}
				title={messages.OPENAPI_SPEC_PAGE_TITLE}
				icon={<BookText className="h-4 w-4" />}
				tone="border-primary/20 bg-primary/10 text-primary dark:border-primary/30 dark:bg-primary/15"
				actions={<OpenLitContextIds />}
			/>
			<div className="flex-1 w-full p-4 overflow-hidden grow  overflow-hidden">
				<ApiReference userApiKey={userApiKey} />
			</div>
		</div>
	);
}
