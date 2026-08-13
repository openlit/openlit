"use client";
import ApiReference from "@/components/(playground)/api-keys/api-reference";
import FeaturePageHeader from "@/components/(playground)/feature-page-header";
import { ApiKey } from "@/types/api-key";
import { BookText  } from "lucide-react";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";

export default function OpenApiPage() {
	const { data } = useFetchWrapper<ApiKey[]>();

	const userApiKey = data && data.length > 0 ? data[0].apiKey : undefined;

	return (
		<div className="flex flex-col grow w-full h-full overflow-hidden">
			<FeaturePageHeader
				eyebrow="Documentation"
				title="Open API Spec"
				icon={<BookText className="h-4 w-4" />}
				tone="border-primary/20 bg-primary/10 text-primary dark:border-primary/30 dark:bg-primary/15"
			/>
			<div className="flex-1 w-full p-4 overflow-hidden grow  overflow-hidden">
				<ApiReference userApiKey={userApiKey} />
			</div>
		</div>
	);
}
