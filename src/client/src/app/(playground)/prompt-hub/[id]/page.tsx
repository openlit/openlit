"use client";
import PromptHubHeader from "@/components/(playground)/prompt-hub/header";
import RuleForm from "@/components/(playground)/rule-engine/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getPingStatus } from "@/selectors/database-config";
import { useRootStore } from "@/store";
import { Prompt, PromptVersion, PromptVersionStatus } from "@/types/prompt";
import { Rule, RuleEntity } from "@/types/rule-engine";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { jsonParse } from "@/utils/json";
import { objectEntries } from "@/utils/object";
import { unescapeString } from "@/utils/string";
import { format, formatDistance } from "date-fns";
import { CalendarDays, CloudDownload, LinkIcon, PlusIcon, Rocket, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import {
	useParams,
	useSearchParams,
} from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

export default function PromptHub() {
	const pingStatus = useRootStore(getPingStatus);
	const params = useParams();
	const searchParams = useSearchParams();
	const version = searchParams.get("version") || undefined;
	const { data, fireRequest, isFetched, isLoading } = useFetchWrapper<Prompt>();

	const [selectedRuleId, setSelectedRuleId] = useState("");
	const [isLinkingOpen, setIsLinkingOpen] = useState(false);

	const { fireRequest: fetchEntitiesReq, data: entities } =
		useFetchWrapper<RuleEntity[]>();
	const { fireRequest: fetchRulesReq, data: allRules } =
		useFetchWrapper<Rule[]>();
	const { fireRequest: fireLinkRule, isLoading: isLinkingRule } =
		useFetchWrapper();

	const fetchData = useCallback(async () => {
		fireRequest({
			requestType: "GET",
			url: `/api/prompt/get/${params.id}${version ? "?version=" + version : ""}`,
			responseDataKey: "data.[0]",
			failureCb: (err?: string) => {
				toast.error(err || `Cannot connect to server!`, {
					id: "prompt-hub",
				});
			},
		});
	}, [version]);

	const fetchLinkedRules = useCallback(() => {
		fetchEntitiesReq({
			requestType: "GET",
			url: `/api/rule-engine/entities?entity_type=prompt&entity_id=${params.id}`,
			failureCb: () => { },
		});
		fetchRulesReq({
			requestType: "GET",
			url: `/api/rule-engine/rules`,
			failureCb: () => { },
		});
	}, [params.id]);

	useEffect(() => {
		if (pingStatus === "success") fetchData();
	}, [version, pingStatus]);

	useEffect(() => {
		if ((data as any)?.promptId) {
			fetchLinkedRules();
		}
	}, [(data as any)?.promptId]);

	const linkExistingRule = useCallback(() => {
		if (!selectedRuleId) {
			toast.error("Please select a rule", { id: "prompt-link" });
			return;
		}
		fireLinkRule({
			body: JSON.stringify({
				rule_id: selectedRuleId,
				entity_type: "prompt",
				entity_id: params.id,
			}),
			requestType: "POST",
			url: "/api/rule-engine/entities",
			successCb: () => {
				toast.success("Rule linked to prompt!", { id: "prompt-link" });
				setSelectedRuleId("");
				setIsLinkingOpen(false);
				fetchLinkedRules();
			},
			failureCb: (err?: string) => {
				toast.error(err || "Failed to link rule", { id: "prompt-link" });
			},
		});
	}, [selectedRuleId, params.id]);

	const linkedRuleIds = new Set(
		((entities as any[]) || []).map((e: any) => e.rule_id)
	);
	const linkedRules = ((allRules as any[]) || []).filter((r: any) =>
		linkedRuleIds.has(r.id)
	);
	const unlinkedRules = ((allRules as any[]) || []).filter(
		(r: any) => !linkedRuleIds.has(r.id)
	);

	if (!isFetched || (!(data as any)?.promptId && isLoading)) {
		return (
			<div className="flex flex-col w-full h-full overflow-hidden gap-6 items-center justify-center">
				<div className="h-4 w-1/5 bg-secondary/[0.9] rounded" />
				<div className="h-4 w-3/5 bg-secondary/[0.9] rounded" />
				<div className="h-4 w-2/3 bg-secondary/[0.9] rounded" />
				<div className="h-4 w-1/3 bg-secondary/[0.9] rounded" />
			</div>
		);
	}

	if (!data || !(data as any)?.promptId) {
		return (
			<div className="flex w-full h-full overflow-hidden items-center justify-center text-stone-600 dark:text-stone-400">
				No such prompt exists!
			</div>
		);
	}

	if (
		(data as any)?.promptId &&
		version &&
		(data as any).version !== version &&
		!isLoading
	) {
		return (
			<div className="flex w-full h-full overflow-hidden items-center justify-center text-stone-600 dark:text-stone-400">
				No such version of the prompt{" "}
				<span className="bg-secondary text-primary px-2 text-sm mx-3">
					{" "}
					{(data as any).name}{" "}
				</span>{" "}
				exists!
			</div>
		);
	}

	const tags = jsonParse((data as any).versions[0].tags) || [];
	const metaProperties =
		jsonParse((data as any).versions[0].metaProperties) || {};
	const metaPropertiesMap = objectEntries(metaProperties);

	const latestVersion = (data as any).versions.find(
		(v: PromptVersion) => v.status !== PromptVersionStatus.DRAFT
	);
	const draftVersion = (data as any).versions.find(
		(v: PromptVersion) => v.status === PromptVersionStatus.DRAFT
	);

	const promptText = unescapeString((data as any).prompt);

	return (
		<div className="flex flex-col w-full h-full gap-4">
			<PromptHubHeader />
			<div className="grid grid-cols-3 w-full h-full overflow-hidden gap-4">
				{/* Left: prompt details */}
				<Card className="grow col-span-2 overflow-hidden flex flex-col border border-stone-200 dark:border-stone-800">
					<CardHeader className="p-4 border-b border-stone-200 dark:border-stone-800">
						<CardTitle>
							<div className="flex w-full">
								<div className="flex flex-col grow">
									<div className="flex items-center text-2xl font-semibold text-stone-900 dark:text-stone-100 gap-4">
										<h1>{(data as any).name}</h1>
										{(data as any).status === PromptVersionStatus.DRAFT && (
											<Badge
												variant="default"
												className="transition-none py-0 text-xs"
											>
												Draft
											</Badge>
										)}
									</div>
									<div className="flex items-center text-stone-500 dark:text-stone-400 gap-8 mt-2">
										<div className="flex items-center">
											<Rocket className="mr-2 h-4 w-4" />
											<span className="text-xs">
												{(data as any).version}
											</span>
										</div>
										<div className="flex items-center">
											<CalendarDays className="mr-2 h-4 w-4" />
											<span className="text-xs">
												Published on {format((data as any).updatedAt, "MMM do, y")}
											</span>
										</div>
									</div>
								</div>
								<div className="flex items-center">
									{(data as any).versionId === draftVersion?.versionId ? (
										<Button
											asChild
											variant="secondary"
											className="bg-primary hover:bg-primary dark:bg-primary dark:hover:bg-primary text-stone-100 dark:text-stone-100 px-8 h-9 py-1 rounded-sm"
										>
											<Link href={`/prompt-hub/${params.id}/edit`}>
												Publish Version
											</Link>
										</Button>
									) : null}
									{(data as any).version === latestVersion?.version &&
										!draftVersion?.version ? (
										<Button
											asChild
											variant="secondary"
											className="bg-primary hover:bg-primary dark:bg-primary dark:hover:bg-primary text-stone-100 dark:text-stone-100 px-8 h-9 py-1 rounded-sm"
										>
											<Link href={`/prompt-hub/${params.id}/edit`}>
												Create New Version
											</Link>
										</Button>
									) : null}
								</div>
							</div>
						</CardTitle>
					</CardHeader>
					<CardContent className="flex flex-col w-full p-4 pt-4 gap-4 overflow-auto scrollbar-hidden">
						{tags.length > 0 ? (
							<div className="flex gap-2 flex-wrap">
								{tags.map((tag: string) => (
									<Badge
										key={tag}
										className="rounded-pill bg-stone-500 transition-none"
									>
										{tag}
									</Badge>
								))}
							</div>
						) : null}

						{/* Prompt with Write / Preview tabs */}
						<div className="flex flex-col gap-2 flex-1">
							<h3 className="text-sm font-medium text-stone-500 dark:text-stone-400">
								Prompt
							</h3>
							<div className="min-h-[200px] h-full bg-stone-50 dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-md p-4 overflow-auto scrollbar-hidden">
								{promptText ? (
									<div className="prose prose-sm dark:prose-invert max-w-none prose-stone prose-headings:font-semibold prose-code:rounded prose-code:px-1 prose-pre:bg-stone-100 dark:prose-pre:bg-stone-800">
										<ReactMarkdown>{promptText}</ReactMarkdown>
									</div>
								) : (
									<p className="text-sm text-stone-400 dark:text-stone-600 italic">
										No prompt content.
									</p>
								)}
							</div>
						</div>

						{metaPropertiesMap.length > 0 ? (
							<div className="flex flex-col gap-2">
								<h3 className="text-sm font-medium text-stone-500 dark:text-stone-400">
									Meta Properties
								</h3>
								<div className="rounded-sm border border-stone-200 dark:border-stone-800">
									<Table>
										<TableHeader className="bg-stone-100 dark:bg-stone-800">
											<TableRow>
												<TableHead className="h-8 text-stone-400">Key</TableHead>
												<TableHead className="h-8 text-stone-400">Value</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{metaPropertiesMap.map(([itemKey, value]: string[]) => (
												<TableRow
													key={itemKey}
													className="bg-stone-50 dark:bg-stone-900 data-[state=selected]:bg-stone-50 dark:data-[state=selected]:bg-stone-900 text-stone-600 dark:text-stone-300"
												>
													<TableCell className="p-0 px-4 align-middle font-medium h-10">
														{itemKey}
													</TableCell>
													<TableCell className="p-0 px-4 align-middle h-10">
														{value}
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								</div>
							</div>
						) : null}
					</CardContent>
				</Card>

				{/* Right: tabbed Versions + Rules */}
				<Card className="flex flex-col overflow-hidden border border-stone-200 dark:border-stone-800">
					<Tabs defaultValue="versions" className="flex flex-col h-full overflow-hidden">
						<CardHeader className="p-0 flex-shrink-0 border-b border-stone-200 dark:border-stone-800">
							<TabsList className="w-full rounded-none bg-stone-50 dark:bg-stone-900 border-b border-stone-200 dark:border-stone-800 h-10 gap-0 p-0">
								<TabsTrigger
									value="versions"
									className="flex-1 rounded-none h-full data-[state=active]:bg-white dark:data-[state=active]:bg-stone-950 data-[state=active]:border-b-2 data-[state=active]:border-primary text-stone-600 dark:text-stone-400 data-[state=active]:text-stone-900 dark:data-[state=active]:text-stone-100 text-sm"
								>
									Versions
								</TabsTrigger>
								<TabsTrigger
									value="rules"
									className="flex-1 rounded-none h-full data-[state=active]:bg-white dark:data-[state=active]:bg-stone-950 data-[state=active]:border-b-2 data-[state=active]:border-primary text-stone-600 dark:text-stone-400 data-[state=active]:text-stone-900 dark:data-[state=active]:text-stone-100 text-sm"
								>
									Rules
									{linkedRules.length > 0 && (
										<span className="ml-1.5 text-xs bg-primary text-white rounded-full px-1.5 py-0.5 leading-none">
											{linkedRules.length}
										</span>
									)}
								</TabsTrigger>
							</TabsList>
						</CardHeader>

						{/* Versions tab */}
						<TabsContent value="versions" className="flex-1 overflow-y-auto scrollbar-hidden mt-0">
							<CardContent className="p-4">
								<div className="flex flex-col w-full gap-4">
									{(data as any).versions.map((versionItem: PromptVersion) => (
										<Link
											href={`/prompt-hub/${params.id}${versionItem.status === PromptVersionStatus.DRAFT
												? ""
												: `?version=${versionItem.version}`
												}`}
											key={versionItem.versionId}
											className="flex w-full items-center text-sm gap-2 text-stone-500 dark:text-stone-300"
										>
											<div className="flex w-min gap-2">
												{versionItem.version}
												{versionItem.versionId === latestVersion?.versionId ? (
													<Badge
														variant="outline"
														className="rounded-pill text-xs text-stone-500 dark:text-stone-300 dark:border-stone-600 font-light transition-none"
													>
														latest
													</Badge>
												) : null}
												{versionItem.versionId === draftVersion?.versionId ? (
													<Badge
														variant="outline"
														className="rounded-pill text-xs text-stone-500 dark:text-stone-300 dark:border-stone-600 font-light transition-none"
													>
														Draft
													</Badge>
												) : null}
											</div>
											<hr className="flex-1 border-stone-400 dark:border-stone-500 border-dotted" />
											<div className="flex gap-1 text-xs items-center shrink-0">
												<CloudDownload className="w-4" />
												{versionItem.totalDownloads}
											</div>
											...
											<div className="w-max">
												{formatDistance(
													new Date(versionItem.updatedAt),
													new Date().toISOString().slice(0, -1),
													{ addSuffix: true }
												)}
											</div>
										</Link>
									))}
								</div>
							</CardContent>
						</TabsContent>

						{/* Rules tab */}
						<TabsContent value="rules" className="flex-1 overflow-y-auto scrollbar-hidden mt-0 flex flex-col">
							<CardHeader className="p-4 pb-3 border-b border-stone-200 dark:border-stone-800 flex-shrink-0">
								<div className="flex items-center justify-between">
									<CardTitle className="text-base text-stone-800 dark:text-stone-200">
										Linked Rules
									</CardTitle>
									<RuleForm
										entityId={params.id as string}
										entityType="prompt"
										successCallback={fetchLinkedRules}
									>
										<Button
											size="sm"
											variant="outline"
											className="h-7 text-xs border-stone-300 dark:border-stone-600 text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100"
										>
											<PlusIcon className="w-3 h-3 mr-1" />
											New Rule
										</Button>
									</RuleForm>
								</div>
							</CardHeader>
							<CardContent className="p-4 pt-3 flex flex-col gap-4 flex-1 overflow-y-auto scrollbar-hidden">
								{linkedRules.length === 0 ? (
									<div className="flex flex-col items-center justify-center py-6 gap-2">
										<SlidersHorizontal className="w-7 h-7 text-stone-300 dark:text-stone-600" />
										<p className="text-sm text-stone-400 dark:text-stone-500 text-center">
											No rules linked yet.
										</p>
									</div>
								) : (
									<div className="flex flex-col gap-2">
										{linkedRules.map((rule: any) => (
											<Link
												key={rule.id}
												href={`/rule-engine/${rule.id}`}
												className="flex items-center justify-between p-3 rounded-md border border-stone-200 dark:border-stone-800 hover:border-stone-300 dark:hover:border-stone-700 hover:bg-stone-50 dark:hover:bg-stone-800/50 transition-colors group"
											>
												<div className="flex flex-col gap-0.5 min-w-0">
													<span className="text-sm font-medium text-stone-800 dark:text-stone-200 group-hover:text-stone-900 dark:group-hover:text-stone-100 truncate">
														{rule.name}
													</span>
													{rule.description && (
														<span className="text-xs text-stone-400 dark:text-stone-500 truncate">
															{rule.description}
														</span>
													)}
												</div>
												<div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
													<Badge
														variant={rule.status === "ACTIVE" ? "default" : "secondary"}
														className="text-xs"
													>
														{rule.status}
													</Badge>
												</div>
											</Link>
										))}
									</div>
								)}

								<div className="flex flex-col gap-2 pt-2 border-t border-stone-200 dark:border-stone-800">
									<button
										type="button"
										onClick={() => setIsLinkingOpen((v) => !v)}
										className="flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 transition-colors self-start"
									>
										<LinkIcon className="w-3 h-3" />
										{isLinkingOpen ? "Cancel" : "Link existing rule"}
									</button>
									{isLinkingOpen && (
										<div className="flex flex-col gap-2">
											<Select
												value={selectedRuleId}
												onValueChange={setSelectedRuleId}
											>
												<SelectTrigger className="h-8 text-sm border-stone-300 dark:border-stone-600">
													<SelectValue placeholder="Select a rule..." />
												</SelectTrigger>
												<SelectContent>
													{unlinkedRules.length === 0 ? (
														<div className="px-3 py-2 text-xs text-stone-400 dark:text-stone-500">
															All rules already linked
														</div>
													) : (
														unlinkedRules.map((rule: any) => (
															<SelectItem key={rule.id} value={rule.id}>
																<span className="flex items-center gap-2">
																	<span>{rule.name}</span>
																	<Badge
																		variant={rule.status === "ACTIVE" ? "default" : "secondary"}
																		className="text-[9px] px-1 py-0 h-3.5"
																	>
																		{rule.status}
																	</Badge>
																</span>
															</SelectItem>
														))
													)}
												</SelectContent>
											</Select>
											<Button
												size="sm"
												variant="outline"
												disabled={!selectedRuleId || isLinkingRule}
												onClick={linkExistingRule}
												className={`border-stone-300 dark:border-stone-600 text-stone-600 dark:text-stone-400 ${isLinkingRule ? "animate-pulse" : ""}`}
											>
												<LinkIcon className="w-3 h-3 mr-1" />
												Associate
											</Button>
										</div>
									)}
								</div>
							</CardContent>
						</TabsContent>
					</Tabs>
				</Card>
			</div>
		</div>
	);
}
