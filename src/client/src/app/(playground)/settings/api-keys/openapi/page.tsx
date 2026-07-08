"use client";
import ApiKeysHeader from "@/components/(playground)/api-keys/header-tabs";
import getMessage from "@/constants/messages";

export default function OpenApiPage() {
	const messages = getMessage();

	return (
		<div className="flex flex-col grow w-full h-full overflow-hidden">
			<ApiKeysHeader />
			<div className="flex-1 w-full p-4 overflow-hidden">
				<div className="w-full h-full border border-stone-200 dark:border-stone-800 rounded-lg overflow-hidden bg-white dark:bg-stone-900 shadow-sm">
					<iframe
						src="/api-docs.html"
						className="w-full h-full border-0"
						title={messages.OPENAPI_SPECIFICATION_UI}
					/>
				</div>
			</div>
		</div>
	);
}
