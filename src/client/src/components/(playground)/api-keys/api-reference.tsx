"use client";
import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CopyIcon, Terminal, FileText, ChevronRight, Check } from "lucide-react";
import copy from "copy-to-clipboard";
import getMessage from "@/constants/messages";

import { ApiEndpoint, API_REFERENCE_ENDPOINTS } from "@/constants/api-reference";

interface ParameterDoc {
	name: string;
	type: string;
	required: boolean;
	description: string;
	allowedValues?: string[];
	example?: string;
}

interface ApiReferenceProps {
	userApiKey?: string;
}

export default function ApiReference({ userApiKey }: ApiReferenceProps) {
	const activeKey = userApiKey || "YOUR_OPENLIT_API_KEY";
	const [selectedEndpoint, setSelectedEndpoint] = useState<ApiEndpoint>(API_REFERENCE_ENDPOINTS[0]);
	const [copiedField, setCopiedField] = useState<string | null>(null);
	const messages = getMessage();

	const getParameterDocs = (endpointId: string): ParameterDoc[] => {
		if (
			endpointId === "query-traces" ||
			endpointId === "query-exceptions" ||
			endpointId === "query-logs" ||
			endpointId === "query-metrics" ||
			endpointId === "get-metric-detail"
		) {
			const isLog = endpointId === "query-logs";
			const isMetric = endpointId === "query-metrics" || endpointId === "get-metric-detail";
			const docs: ParameterDoc[] = [
				{
					name: "timeLimit",
					type: "object",
					required: true,
					description: "Specifies the time range window to query telemetry.",
				},
				{
					name: "timeLimit.type",
					type: "string",
					required: true,
					description: "Predefined relative duration or custom time range.",
					allowedValues: ["24H", "7D", "1M", "3M", "CUSTOM"],
					example: "24H",
				},
				{
					name: "timeLimit.start",
					type: "string",
					required: false,
					description: "ISO-8601 start timestamp. Required if type is CUSTOM.",
					example: "2026-07-09T13:08:52.311Z",
				},
				{
					name: "timeLimit.end",
					type: "string",
					required: false,
					description: "ISO-8601 end timestamp. Required if type is CUSTOM.",
					example: "2026-07-10T13:09:17.114Z",
				},
				{
					name: "limit",
					type: "number",
					required: false,
					description: `Pagination limit. Defaults to ${isLog || isMetric ? 25 : 10}.`,
					example: "50",
				},
				{
					name: "offset",
					type: "number",
					required: false,
					description: "Pagination offset index. Defaults to 0.",
					example: "0",
				},
				{
					name: "selectedConfig",
					type: "object",
					required: false,
					description: "Structured filter properties for telemetry queries.",
				},
				{
					name: "selectedConfig.models",
					type: "string[]",
					required: false,
					description: "Filter records by specific AI model names.",
					example: '["gpt-4o", "claude-3-5-sonnet"]',
				},
				{
					name: "selectedConfig.providers",
					type: "string[]",
					required: false,
					description: "Filter records by specific LLM providers.",
					example: '["openai", "anthropic"]',
				},
				{
					name: "selectedConfig.serviceNames",
					type: "string[]",
					required: false,
					description: "Filter records by specific client service names.",
					example: '["web-app"]',
				},
				{
					name: "selectedConfig.environments",
					type: "string[]",
					required: false,
					description: "Filter records by deployment environment.",
					example: '["production"]',
				},
			];

			if (isLog) {
				docs.push({
					name: "selectedConfig.severities",
					type: "string[]",
					required: false,
					description: "Filter logs by severity levels.",
					allowedValues: ["INFO", "WARN", "ERROR", "DEBUG", "FATAL"],
					example: '["ERROR", "WARN"]',
				});
			}

			if (endpointId !== "get-metric-detail" && endpointId !== "query-metrics") {
				docs.push(
					{
						name: "sorting",
						type: "object",
						required: false,
						description: "Database sorting order rules.",
					},
					{
						name: "sorting.type",
						type: "string",
						required: false,
						description: "Field name to sort by (e.g. Timestamp, cost, duration, prompt_tokens, completion_tokens).",
						example: "Timestamp",
					},
					{
						name: "sorting.direction",
						type: "string",
						required: false,
						description: "Sorting direction.",
						allowedValues: ["asc", "desc"],
						example: "desc",
					}
				);
			}

			docs.push({
				name: "includeFilters",
				type: "boolean",
				required: false,
				description: "If true, appends the pagination and dynamic filter metadata inline in the response.",
				example: "true",
			});

			return docs;
		}

		if (endpointId === "get-log") {
			return [
				{
					name: "id",
					type: "string",
					required: true,
					description: "Path parameter. Unique hash/row identifier of the log record.",
					example: "18446744073709551615",
				},
			];
		}

		if (endpointId === "get-compiled-prompt") {
			return [
				{
					name: "name",
					type: "string",
					required: true,
					description: "Query parameter. Prompt template identifier name.",
					example: "summarize-prompt",
				},
			];
		}

		if (endpointId === "get-secrets") {
			return [
				{
					name: "keys",
					type: "string",
					required: false,
					description: "Query parameter. Comma-separated list of keys to fetch from the vault.",
					example: "OPENAI_API_KEY,ANTHROPIC_API_KEY",
				},
			];
		}

		if (endpointId === "evaluate-rules") {
			return [
				{
					name: "entity_type",
					type: "string",
					required: true,
					description: "Type of rule engine entity to evaluate.",
					allowedValues: ["prompt", "span"],
					example: "prompt",
				},
				{
					name: "fields",
					type: "object",
					required: true,
					description: "Input fields to run redaction, guardrail, or format rules against.",
					example: "{ \"input_text\": \"...\" }",
				},
			];
		}

		if (endpointId === "controller-poll") {
			return [
				{
					name: "instance_id",
					type: "string",
					required: true,
					description: "Unique identifier for the polling client agent instance.",
					example: "client-instance-xyz-123",
				},
				{
					name: "config_hash",
					type: "string",
					required: false,
					description: "MD5 hash of the cached controller config on the client side.",
					example: "88863aa992efcc3c48bc625d97f26c51",
				},
			];
		}

		if (endpointId === "evaluation-offline") {
			return [
				{
					name: "prompt",
					type: "string",
					required: true,
					description: "The prompt text to evaluate.",
					example: "I need to reset my password, my email is admin@gmail.com",
				},
				{
					name: "response",
					type: "string",
					required: true,
					description: "The LLM generated response to evaluate.",
					example: "I can help with that. Please verify your identity.",
				},
				{
					name: "contexts",
					type: "string[]",
					required: false,
					description: "Retrieved context document texts used by the LLM.",
					example: '["User password reset procedure document."]',
				},
				{
					name: "eval_types",
					type: "string[]",
					required: false,
					description: "Scorers to execute. Can be toxicity, hallucination, bias, pii.",
					example: '["toxicity", "pii"]',
				},
				{
					name: "threshold_score",
					type: "number",
					required: false,
					description: "Minimum score required to trigger validation flags. Defaults to 0.5.",
					example: "0.5",
				},
				{
					name: "store_results",
					type: "boolean",
					required: false,
					description: "Persist the evaluation metrics run results to ClickHouse. Defaults to true.",
					example: "true",
				},
				{
					name: "run_id",
					type: "string",
					required: false,
					description: "Optional external execution or batch tracking ID.",
					example: "run-998877",
				},
				{
					name: "metadata",
					type: "object",
					required: false,
					description: "Custom metadata key-value properties dictionary (max 20 entries).",
				},
				{
					name: "attributes",
					type: "object",
					required: false,
					description: "Custom payload attributes dictionary.",
				},
			];
		}

		if (endpointId === "create-prompt") {
			return [
				{
					name: "name",
					type: "string",
					required: true,
					description: "Unique prompt identification name.",
					example: "rag-generation-prompt",
				},
				{
					name: "prompt",
					type: "string",
					required: true,
					description: "Prompt template string with support for variable placeholders.",
					example: "Answer the query: {{query}} using context: {{context}}",
				},
				{
					name: "version",
					type: "string",
					required: false,
					description: "Optional semantic version for this prompt release.",
					example: "1.0.0",
				},
				{
					name: "status",
					type: "string",
					required: false,
					description: "Release status of the prompt.",
					allowedValues: ["active", "draft", "retired"],
					example: "active",
				},
				{
					name: "tags",
					type: "string[]",
					required: false,
					description: "Labels to categorize the prompt.",
					example: '["production", "rag"]',
				},
				{
					name: "metaProperties",
					type: "object",
					required: false,
					description: "Arbitrary key-value metadata properties dict.",
				},
			];
		}

		if (endpointId === "get-prompt") {
			return [
				{
					name: "name",
					type: "string",
					required: true,
					description: "Prompt identifier name to retrieve detail configurations for.",
					example: "summarize-prompt",
				},
			];
		}

		if (endpointId === "upsert-secret") {
			return [
				{
					name: "key",
					type: "string",
					required: true,
					description: "Secret key name stored in the vault.",
					example: "OPENAI_API_KEY",
				},
				{
					name: "value",
					type: "string",
					required: true,
					description: "Unencrypted credentials value that will be encrypted on write.",
					example: "sk-proj-...",
				},
				{
					name: "tags",
					type: "string[]",
					required: false,
					description: "Secret classification labels.",
					example: '["production"]',
				},
			];
		}

		if (
			endpointId === "get-span-detail" ||
			endpointId === "get-trace-detail" ||
			endpointId === "get-span-hierarchy"
		) {
			return [
				{
					name: "id",
					type: "string",
					required: true,
					description: "Path parameter. Span ID, Trace ID, or Anchor Span ID to fetch.",
					example: "557a2bd43ff129ad",
				},
			];
		}

		return [];
	};

	const getEndpointGroup = (endpoint: ApiEndpoint): string => {
		const path = endpoint.path;
		if (path.startsWith("/api/telemetry") || path.startsWith("/api/metrics")) {
			return "Telemetry";
		}
		if (path.startsWith("/api/prompt")) {
			return "Prompt Hub";
		}
		if (path.startsWith("/api/vault")) {
			return "Secret Vault";
		}
		if (path.startsWith("/api/rule-engine")) {
			return "Rule Engine";
		}
		if (path.startsWith("/api/controller")) {
			return "Controller";
		}
		if (path.startsWith("/api/evaluation")) {
			return "Evaluation Engine";
		}
		if (path.startsWith("/api/api-key")) {
			return "API Keys";
		}
		return "Other";
	};

	const groups = [
		"Telemetry",
		"Prompt Hub",
		"Secret Vault",
		"Rule Engine",
		"Controller",
		"Evaluation Engine",
		"API Keys"
	];

	const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
		"Telemetry": true,
		"Prompt Hub": true,
		"Secret Vault": true,
		"Rule Engine": true,
		"Controller": true,
		"Evaluation Engine": true,
		"API Keys": true,
	});

	const toggleGroup = (group: string) => {
		setExpandedGroups(prev => ({
			...prev,
			[group]: !prev[group]
		}));
	};

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

			<div className="flex flex-col lg:flex-row divide-y lg:divide-y-0 lg:divide-x divide-stone-200 dark:divide-stone-800 h-full overflow-hidden">
				{/* Sidebar list */}
				<div className="w-full lg:w-80 shrink-0 bg-stone-50/50 dark:bg-stone-950/20 py-2 overflow-y-auto h-full">
					<div className="space-y-2 px-2">
						{groups.map((group) => {
							const endpointsInGroup = API_REFERENCE_ENDPOINTS.filter(
								(ep) => getEndpointGroup(ep) === group
							);
							if (endpointsInGroup.length === 0) return null;
							const isExpanded = expandedGroups[group] ?? true;

							return (
								<div key={group} className="flex flex-col">
									<button
										onClick={() => toggleGroup(group)}
										className="flex items-center justify-between w-full px-3 py-1.5 text-left text-[11px] font-semibold text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200 transition-colors uppercase tracking-wider"
									>
										<span>{group}</span>
										<ChevronRight
											className={`h-3 w-3 text-stone-400 dark:text-stone-505 transition-transform ${
												isExpanded ? "rotate-90" : ""
											}`}
										/>
									</button>
									{isExpanded && (
										<div className="mt-1 space-y-0.5 pl-2 border-l border-stone-200 dark:border-stone-800 ml-3">
											{endpointsInGroup.map((endpoint) => (
												<button
													key={endpoint.id}
													onClick={() => setSelectedEndpoint(endpoint)}
													className={`w-full flex items-center text-left px-3 py-2 rounded-md text-xs transition-colors ${
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
												</button>
											))}
										</div>
									)}
								</div>
							);
						})}
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

					{/* Parameters Reference */}
					{getParameterDocs(selectedEndpoint.id).length > 0 && (
						<div className="mb-6">
							<details className="group border border-stone-200 dark:border-stone-800 rounded-md bg-stone-50/50 dark:bg-stone-900/30">
								<summary className="flex items-center justify-between p-3 font-semibold text-xs text-stone-700 dark:text-stone-300 cursor-pointer hover:bg-stone-50 dark:hover:bg-stone-900/60 select-none">
									<span>Parameters Reference ({getParameterDocs(selectedEndpoint.id).length})</span>
									<ChevronRight className="h-4 w-4 text-stone-400 transition-transform group-open:rotate-90" />
								</summary>
								<div className="p-3 border-t border-stone-200 dark:border-stone-800 overflow-x-auto">
									<table className="w-full text-left text-xs border-collapse">
										<thead>
											<tr className="border-b border-stone-200 dark:border-stone-800 text-stone-500 font-medium">
												<th className="pb-2 pr-4 font-mono text-[10px]">Parameter</th>
												<th className="pb-2 pr-4 font-mono text-[10px]">Type</th>
												<th className="pb-2 pr-4 font-mono text-[10px]">Required</th>
												<th className="pb-2">Description</th>
											</tr>
										</thead>
										<tbody>
											{getParameterDocs(selectedEndpoint.id).map((doc) => (
												<tr key={doc.name} className="border-b border-stone-100 dark:border-stone-900/40 last:border-0 hover:bg-stone-50/50 dark:hover:bg-stone-900/20">
													<td className="py-2.5 pr-4 font-mono text-[11px] font-semibold text-stone-800 dark:text-stone-200">
														{doc.name}
													</td>
													<td className="py-2.5 pr-4 font-mono text-[11px] text-stone-500">
														{doc.type}
													</td>
													<td className="py-2.5 pr-4">
														{doc.required ? (
															<Badge className="bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400 border-red-100 dark:border-red-900/30 text-[9px] px-1.5 py-0 font-bold">Required</Badge>
														) : (
															<span className="text-[10px] text-stone-400 font-medium">Optional</span>
														)}
													</td>
													<td className="py-2.5 text-stone-600 dark:text-stone-400 leading-relaxed text-[11px]">
														<div>{doc.description}</div>
														{doc.allowedValues && (
															<div className="mt-1 text-[10px] text-stone-500 flex flex-wrap gap-1 items-center">
																<span className="font-semibold text-stone-400">Allowed: </span>
																{doc.allowedValues.map(val => <code key={val} className="bg-stone-100 dark:bg-stone-800 px-1 py-0.5 rounded text-[10px] text-stone-600 dark:text-stone-300">{val}</code>)}
															</div>
														)}
														{doc.example && (
															<div className="mt-1 text-[10px] text-stone-500">
																<span className="font-semibold text-stone-400">Example: </span>
																<code className="bg-stone-100 dark:bg-stone-800 px-1 py-0.5 rounded text-[10px] text-stone-600 dark:text-stone-300">{doc.example}</code>
															</div>
														)}
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							</details>
						</div>
					)}

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
