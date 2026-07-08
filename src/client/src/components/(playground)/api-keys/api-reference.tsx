"use client";
import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CopyIcon, Terminal, FileText, ChevronRight, Check } from "lucide-react";
import copy from "copy-to-clipboard";
import getMessage from "@/constants/messages";

import { ApiEndpoint, API_REFERENCE_ENDPOINTS } from "@/constants/api-reference";

interface ApiReferenceProps {
	userApiKey?: string;
}

export default function ApiReference({ userApiKey }: ApiReferenceProps) {
	const activeKey = userApiKey || "YOUR_OPENLIT_API_KEY";
	const [selectedEndpoint, setSelectedEndpoint] = useState<ApiEndpoint>(API_REFERENCE_ENDPOINTS[0]);
	const [copiedField, setCopiedField] = useState<string | null>(null);
	const messages = getMessage();

	const handleCopy = (text: string, fieldId: string) => {
		copy(text);
		setCopiedField(fieldId);
		toast.success(messages.COPIED_TO_CLIPBOARD);
		setTimeout(() => setCopiedField(null), 2000);
	};

	const getMethodColor = (method: string) => {
		switch (method) {
			case "GET":
				return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20";
			case "POST":
				return "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20";
			case "DELETE":
				return "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20";
			default:
				return "bg-stone-500/10 text-stone-600 dark:text-stone-400 border-stone-500/20";
		}
	};

	return (
		<div className="flex flex-col border border-stone-200 dark:border-stone-800 rounded-lg overflow-hidden bg-white dark:bg-stone-900 shadow-sm h-full">
			<div className="flex items-center gap-2 border-b border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950 px-4 py-3">
				<Terminal className="h-4 w-4 text-stone-500 dark:text-stone-400" />
				<h3 className="font-semibold text-stone-900 dark:text-stone-100">{messages.INTERACTIVE_API_REFERENCE}</h3>
				<span className="text-xs text-stone-500 dark:text-stone-400 ml-auto">
					{messages.OPENAPI_SPEC_BEARER_AUTH}
				</span>
			</div>

			<div className="flex flex-col lg:flex-row divide-y lg:divide-y-0 lg:divide-x divide-stone-200 dark:divide-stone-800 min-h-[450px] h-full overflow-hidden">
				{/* Sidebar list */}
				<div className="w-full lg:w-80 shrink-0 bg-stone-50/50 dark:bg-stone-950/20 py-2 overflow-y-auto h-full">
					<div className="px-3 py-1.5 text-xs font-semibold text-stone-400 dark:text-stone-500 uppercase tracking-wider">
						{messages.AVAILABLE_ENDPOINTS}
					</div>
					<div className="space-y-0.5 px-2">
						{API_REFERENCE_ENDPOINTS.map((endpoint) => (
							<button
								key={endpoint.id}
								onClick={() => setSelectedEndpoint(endpoint)}
								className={`w-full flex items-center text-left px-3 py-2.5 rounded-md text-xs transition-colors ${
									selectedEndpoint.id === endpoint.id
										? "bg-stone-100 dark:bg-stone-800 text-stone-900 dark:text-stone-100 font-medium"
										: "text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-900/50 hover:text-stone-900 dark:hover:text-stone-200"
								}`}
							>
								<Badge
									variant="outline"
									className={`mr-2.5 text-[9px] px-1 py-0 rounded font-bold shrink-0 ${getMethodColor(
										endpoint.method
									)}`}
								>
									{endpoint.method}
								</Badge>
								<span className="truncate flex-1">{endpoint.summary}</span>
								<ChevronRight
									className={`h-3 w-3 text-stone-400 dark:text-stone-500 transition-transform ${
										selectedEndpoint.id === endpoint.id ? "rotate-90" : ""
									}`}
								/>
							</button>
						))}
					</div>
				</div>

				{/* Detail pane */}
				<div className="flex-1 p-6 overflow-y-auto h-full bg-stone-50/10 dark:bg-stone-950/10">
					<div className="flex flex-wrap items-center gap-3 mb-2">
						<Badge
							variant="outline"
							className={`text-xs px-2 py-0.5 rounded font-bold ${getMethodColor(
								selectedEndpoint.method
							)}`}
						>
							{selectedEndpoint.method}
						</Badge>
						<span className="font-mono text-xs text-stone-800 dark:text-stone-200 font-semibold bg-stone-100 dark:bg-stone-800 px-2 py-1 rounded">
							{selectedEndpoint.path}
						</span>
						<button
							onClick={() => handleCopy(selectedEndpoint.path, "path")}
							className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-300"
							title="Copy Path"
						>
							{copiedField === "path" ? (
								<Check className="h-3.5 w-3.5 text-emerald-500" />
							) : (
								<CopyIcon className="h-3.5 w-3.5" />
							)}
						</button>
					</div>

					<h4 className="text-base font-semibold text-stone-900 dark:text-stone-100 mb-2">
						{selectedEndpoint.summary}
					</h4>
					<p className="text-xs text-stone-500 dark:text-stone-400 mb-6 leading-relaxed">
						{selectedEndpoint.description}
					</p>

					{/* CURL Example Section */}
					<div className="mb-6">
						<div className="flex items-center justify-between mb-2">
							<span className="text-xs font-semibold text-stone-700 dark:text-stone-300 flex items-center gap-1.5">
								<Terminal className="h-3.5 w-3.5 text-stone-400" /> {messages.REQUEST_CURL_EXAMPLE}
							</span>
							<button
								onClick={() =>
									handleCopy(selectedEndpoint.curlExample(activeKey), "curl")
								}
								className="text-xs flex items-center gap-1 text-stone-500 hover:text-stone-700 dark:hover:text-stone-300"
							>
								{copiedField === "curl" ? (
									<>
										<Check className="h-3 w-3 text-emerald-500" /> {messages.COPIED}
									</>
								) : (
									<>
										<CopyIcon className="h-3 w-3" /> {messages.COPY_SNIPPET}
									</>
								)}
							</button>
						</div>
						<pre className="p-3 bg-stone-900 text-stone-200 rounded-md font-mono text-[11px] overflow-x-auto leading-relaxed border border-stone-800">
							{selectedEndpoint.curlExample(activeKey)}
						</pre>
					</div>

					{/* Request Body & Response Tabs */}
					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						{selectedEndpoint.requestBody && (
							<div>
								<div className="flex items-center justify-between mb-2">
									<span className="text-xs font-semibold text-stone-700 dark:text-stone-300 flex items-center gap-1.5">
										<FileText className="h-3.5 w-3.5 text-stone-400" /> {messages.REQUEST_PAYLOAD_JSON}
									</span>
									<button
										onClick={() =>
											handleCopy(selectedEndpoint.requestBody || "", "payload")
										}
										className="text-xs text-stone-400 hover:text-stone-600 dark:hover:text-stone-300"
									>
										{copiedField === "payload" ? (
											<Check className="h-3 w-3 text-emerald-500" />
										) : (
											<CopyIcon className="h-3 w-3" />
										)}
									</button>
								</div>
								<pre className="p-3 bg-stone-50 dark:bg-stone-900 text-stone-700 dark:text-stone-300 rounded-md font-mono text-[10px] overflow-x-auto border border-stone-200 dark:border-stone-800">
									{selectedEndpoint.requestBody}
								</pre>
							</div>
						)}

						{selectedEndpoint.responseBody && (
							<div className={selectedEndpoint.requestBody ? "" : "col-span-2"}>
								<div className="flex items-center justify-between mb-2">
									<span className="text-xs font-semibold text-stone-700 dark:text-stone-300 flex items-center gap-1.5">
										<FileText className="h-3.5 w-3.5 text-stone-400" /> {messages.RESPONSE_BODY_JSON}
									</span>
									<button
										onClick={() =>
											handleCopy(selectedEndpoint.responseBody || "", "response")
										}
										className="text-xs text-stone-400 hover:text-stone-600 dark:hover:text-stone-300"
									>
										{copiedField === "response" ? (
											<Check className="h-3 w-3 text-emerald-500" />
										) : (
											<CopyIcon className="h-3 w-3" />
										)}
									</button>
								</div>
								<pre className="p-3 bg-stone-50 dark:bg-stone-900 text-stone-700 dark:text-stone-300 rounded-md font-mono text-[10px] overflow-x-auto border border-stone-200 dark:border-stone-800">
									{selectedEndpoint.responseBody}
								</pre>
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
