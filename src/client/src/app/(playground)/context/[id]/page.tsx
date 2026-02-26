"use client";
import { KeyboardEvent, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { format } from "date-fns";
import {
	CheckIcon,
	PencilIcon,
	PlusIcon,
	SlidersHorizontal,
	XIcon,
	LinkIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { Context } from "@/types/context";
import { Rule, RuleEntity } from "@/types/rule-engine";
import ReactMarkdown from "react-markdown";
import { usePageHeader } from "@/selectors/page";
import RuleForm from "@/components/(playground)/rule-engine/form";
import Link from "next/link";

function parseTags(raw: any): string[] {
	if (Array.isArray(raw)) return raw.map(String);
	try {
		const parsed = JSON.parse(raw || "[]");
		return Array.isArray(parsed) ? parsed.map(String) : [];
	} catch {
		return [];
	}
}

function parseMeta(raw: any): Record<string, string> {
	if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
	try {
		const parsed = JSON.parse(raw || "{}");
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

export default function ContextDetailPage() {
	const params = useParams();
	const contextId = params.id as string;
	const { setHeader } = usePageHeader();

	const [isEditing, setIsEditing] = useState(false);
	const [editName, setEditName] = useState("");
	const [editDescription, setEditDescription] = useState("");
	const [editContent, setEditContent] = useState("");
	const [editStatus, setEditStatus] = useState<"ACTIVE" | "INACTIVE">("ACTIVE");
	const [editTags, setEditTags] = useState<string[]>([]);
	const [editTagInput, setEditTagInput] = useState("");
	const [editMetaProps, setEditMetaProps] = useState<{ key: string; value: string }[]>([]);

	const [selectedRuleId, setSelectedRuleId] = useState("");
	const [isLinking, setIsLinking] = useState(false);

	const { fireRequest: fetchContextReq, data: context, isLoading } =
		useFetchWrapper<Context>();
	const { fireRequest: fetchEntitiesReq, data: entities } =
		useFetchWrapper<RuleEntity[]>();
	const { fireRequest: fetchRulesReq, data: allRules } =
		useFetchWrapper<Rule[]>();
	const { fireRequest: fireUpdateReq, isLoading: isUpdating } =
		useFetchWrapper();
	const { fireRequest: fireLinkRule, isLoading: isLinkingRule } =
		useFetchWrapper();

	const loadContextIntoState = (ctx: any) => {
		setEditName(ctx.name || "");
		setEditDescription(ctx.description || "");
		setEditContent(ctx.content || "");
		setEditStatus(ctx.status || "ACTIVE");
		setEditTags(parseTags(ctx.tags));
		setEditMetaProps(
			Object.entries(parseMeta(ctx.meta_properties)).map(([key, value]) => ({
				key,
				value: String(value),
			}))
		);
	};

	const fetchContext = useCallback(() => {
		fetchContextReq({
			requestType: "GET",
			url: `/api/context/${contextId}`,
			responseDataKey: "[0]",
			successCb: (data: any) => {
				const ctx = Array.isArray(data) ? data[0] : data;
				if (ctx) {
					loadContextIntoState(ctx);
					setHeader({
						title: ctx.name,
						breadcrumbs: [{ title: "Contexts", href: "/context" }],
					});
				}
			},
			failureCb: (err?: string) => {
				toast.error(err || "Failed to load context", { id: "context-detail" });
			},
		});
	}, [contextId]);

	const fetchLinkedRules = useCallback(() => {
		fetchEntitiesReq({
			requestType: "GET",
			url: `/api/rule-engine/entities?entity_type=context&entity_id=${contextId}`,
			failureCb: () => {},
		});
		fetchRulesReq({
			requestType: "GET",
			url: `/api/rule-engine/rules`,
			failureCb: () => {},
		});
	}, [contextId]);

	useEffect(() => {
		fetchContext();
		fetchLinkedRules();
	}, [contextId]);

	const addTag = useCallback(() => {
		const val = editTagInput.trim();
		if (val && !editTags.includes(val)) {
			setEditTags((prev) => [...prev, val]);
		}
		setEditTagInput("");
	}, [editTagInput, editTags]);

	const removeTag = (tag: string) =>
		setEditTags((prev) => prev.filter((t) => t !== tag));

	const addMetaProp = () =>
		setEditMetaProps((prev) => [...prev, { key: "", value: "" }]);

	const removeMetaProp = (idx: number) =>
		setEditMetaProps((prev) => prev.filter((_, i) => i !== idx));

	const updateMetaProp = (idx: number, field: "key" | "value", val: string) =>
		setEditMetaProps((prev) =>
			prev.map((p, i) => (i === idx ? { ...p, [field]: val } : p))
		);

	const saveContext = useCallback(() => {
		const metaProperties = editMetaProps.reduce(
			(acc: Record<string, string>, { key, value }) => {
				if (key.trim()) acc[key.trim()] = value;
				return acc;
			},
			{}
		);

		fireUpdateReq({
			body: JSON.stringify({
				name: editName,
				description: editDescription,
				content: editContent,
				status: editStatus,
				tags: JSON.stringify(editTags),
				meta_properties: JSON.stringify(metaProperties),
			}),
			requestType: "PUT",
			url: `/api/context/${contextId}`,
			successCb: () => {
				toast.success("Context updated successfully!", { id: "context-detail" });
				setIsEditing(false);
				fetchContext();
			},
			failureCb: (err?: string) => {
				toast.error(err || "Failed to update context", { id: "context-detail" });
			},
		});
	}, [contextId, editName, editDescription, editContent, editStatus, editTags, editMetaProps]);

	const linkExistingRule = useCallback(() => {
		if (!selectedRuleId) {
			toast.error("Please select a rule", { id: "context-link" });
			return;
		}
		fireLinkRule({
			body: JSON.stringify({
				rule_id: selectedRuleId,
				entity_type: "context",
				entity_id: contextId,
			}),
			requestType: "POST",
			url: "/api/rule-engine/entities",
			successCb: () => {
				toast.success("Rule linked to context!", { id: "context-link" });
				setSelectedRuleId("");
				setIsLinking(false);
				fetchLinkedRules();
			},
			failureCb: (err?: string) => {
				toast.error(err || "Failed to link rule", { id: "context-link" });
			},
		});
	}, [selectedRuleId, contextId]);

	const linkedRuleIds = new Set(((entities as any[]) || []).map((e: any) => e.rule_id));
	const linkedRules = ((allRules as any[]) || []).filter((r: any) => linkedRuleIds.has(r.id));
	const unlinkdRules = ((allRules as any[]) || []).filter((r: any) => !linkedRuleIds.has(r.id));

	if (isLoading && !context) {
		return (
			<div className="flex flex-col w-full h-full overflow-hidden gap-4 items-center justify-center">
				<div className="h-4 w-1/5 bg-stone-200 dark:bg-stone-700 rounded animate-pulse" />
				<div className="h-4 w-3/5 bg-stone-200 dark:bg-stone-700 rounded animate-pulse" />
				<div className="h-4 w-2/3 bg-stone-200 dark:bg-stone-700 rounded animate-pulse" />
			</div>
		);
	}

	if (!context) return null;

	const ctx = context as any;
	const displayTags = parseTags(ctx.tags);
	const displayMeta = parseMeta(ctx.meta_properties);

	return (
		<div className="grid grid-cols-3 w-full h-full overflow-hidden gap-4">
			{/* Left: Context info + content */}
			<Card className="col-span-2 overflow-hidden flex flex-col border border-stone-200 dark:border-stone-800">
				<CardHeader className="p-4 pb-3 border-b border-stone-100 dark:border-stone-800 flex-shrink-0">
					<div className="flex items-start justify-between gap-4">
						{isEditing ? (
							<Input
								value={editName}
								onChange={(e) => setEditName(e.target.value)}
								className="text-lg font-semibold h-9 border-stone-300 dark:border-stone-600"
							/>
						) : (
							<div className="flex items-center gap-3 flex-wrap">
								<CardTitle className="text-xl text-stone-900 dark:text-stone-100">
									{ctx.name}
								</CardTitle>
								<Badge variant={ctx.status === "ACTIVE" ? "default" : "secondary"}>
									{ctx.status}
								</Badge>
							</div>
						)}
						<div className="flex items-center gap-2 flex-shrink-0">
							{isEditing ? (
								<>
									<Button
										size="sm"
										variant="outline"
										onClick={() => {
											setIsEditing(false);
											loadContextIntoState(ctx);
										}}
										className="h-8 text-stone-600 dark:text-stone-400 border-stone-300 dark:border-stone-600"
									>
										<XIcon className="w-4 h-4 mr-1" />
										Cancel
									</Button>
									<Button
										size="sm"
										onClick={saveContext}
										disabled={isUpdating}
										className={`h-8 ${isUpdating ? "animate-pulse" : ""}`}
									>
										<CheckIcon className="w-4 h-4 mr-1" />
										Save
									</Button>
								</>
							) : (
								<Button
									size="sm"
									variant="ghost"
									onClick={() => setIsEditing(true)}
									className="h-8 text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200"
								>
									<PencilIcon className="w-4 h-4 mr-1" />
									Edit
								</Button>
							)}
						</div>
					</div>
					{!isEditing && ctx.created_by && (
						<p className="text-xs text-stone-400 dark:text-stone-500 mt-1">
							Created by {ctx.created_by}
							{ctx.created_at && <> · {format(ctx.created_at, "MMM do, y")}</>}
						</p>
					)}
				</CardHeader>

				<CardContent className="flex flex-col gap-4 p-4 overflow-y-auto scrollbar-hidden flex-1">
					{/* Description */}
					{isEditing ? (
						<div className="flex flex-col gap-1">
							<label className="text-xs font-medium text-stone-500 dark:text-stone-400">
								Description
							</label>
							<Input
								value={editDescription}
								onChange={(e) => setEditDescription(e.target.value)}
								placeholder="Optional description"
								className="border-stone-300 dark:border-stone-600"
							/>
						</div>
					) : ctx.description ? (
						<p className="text-sm text-stone-600 dark:text-stone-400">{ctx.description}</p>
					) : null}

					{/* Status (edit only) */}
					{isEditing && (
						<div className="flex flex-col gap-1">
							<label className="text-xs font-medium text-stone-500 dark:text-stone-400">
								Status
							</label>
							<Select
								value={editStatus}
								onValueChange={(v) => setEditStatus(v as "ACTIVE" | "INACTIVE")}
							>
								<SelectTrigger className="w-40 border-stone-300 dark:border-stone-600">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="ACTIVE">Active</SelectItem>
									<SelectItem value="INACTIVE">Inactive</SelectItem>
								</SelectContent>
							</Select>
						</div>
					)}

					{/* Tags */}
					<div className="flex flex-col gap-1.5">
						<label className="text-xs font-medium text-stone-500 dark:text-stone-400">
							Tags
						</label>
						{isEditing ? (
							<>
								<div className="flex gap-2">
									<Input
										value={editTagInput}
										onChange={(e) => setEditTagInput(e.target.value)}
										onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
											if (e.key === "Enter") {
												e.preventDefault();
												addTag();
											}
										}}
										placeholder="Add a tag, press Enter"
										className="h-8 text-sm border-stone-300 dark:border-stone-600"
									/>
									<Button
										type="button"
										size="sm"
										variant="outline"
										onClick={addTag}
										className="h-8 border-stone-300 dark:border-stone-600 flex-shrink-0"
									>
										<PlusIcon className="w-3 h-3" />
									</Button>
								</div>
								{editTags.length > 0 && (
									<div className="flex flex-wrap gap-1.5">
										{editTags.map((tag) => (
											<Badge
												key={tag}
												variant="secondary"
												className="flex items-center gap-1 text-xs px-2 py-0.5 bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300"
											>
												{tag}
												<button
													type="button"
													onClick={() => removeTag(tag)}
													className="ml-0.5 hover:text-red-500"
												>
													<XIcon className="w-3 h-3" />
												</button>
											</Badge>
										))}
									</div>
								)}
							</>
						) : displayTags.length > 0 ? (
							<div className="flex flex-wrap gap-1.5">
								{displayTags.map((tag) => (
									<Badge
										key={tag}
										variant="secondary"
										className="text-xs px-2 py-0.5 bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300"
									>
										{tag}
									</Badge>
								))}
							</div>
						) : (
							<span className="text-xs text-stone-400 dark:text-stone-500 italic">None</span>
						)}
					</div>

					{/* Meta Properties */}
					<div className="flex flex-col gap-1.5">
						<label className="text-xs font-medium text-stone-500 dark:text-stone-400">
							Meta Properties
						</label>
						{isEditing ? (
							<>
								{editMetaProps.map((prop, idx) => (
									<div key={idx} className="flex gap-1.5 items-center">
										<Input
											value={prop.key}
											onChange={(e) => updateMetaProp(idx, "key", e.target.value)}
											placeholder="Key"
											className="h-8 text-sm border-stone-300 dark:border-stone-600"
										/>
										<Input
											value={prop.value}
											onChange={(e) => updateMetaProp(idx, "value", e.target.value)}
											placeholder="Value"
											className="h-8 text-sm border-stone-300 dark:border-stone-600"
										/>
										<Button
											type="button"
											size="icon"
											variant="ghost"
											onClick={() => removeMetaProp(idx)}
											className="h-8 w-8 flex-shrink-0 text-stone-400 hover:text-red-500"
										>
											<XIcon className="w-3.5 h-3.5" />
										</Button>
									</div>
								))}
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={addMetaProp}
									className="border-stone-300 dark:border-stone-600 text-stone-600 dark:text-stone-400 self-start"
								>
									<PlusIcon className="w-3.5 h-3.5 mr-1" />
									Add property
								</Button>
							</>
						) : Object.keys(displayMeta).length > 0 ? (
							<div className="flex flex-col gap-1">
								{Object.entries(displayMeta).map(([key, value]) => (
									<div key={key} className="flex items-center gap-2">
										<span className="font-mono text-xs text-stone-500 dark:text-stone-400 bg-stone-100 dark:bg-stone-800 px-1.5 py-0.5 rounded">
											{key}
										</span>
										<span className="text-stone-400 dark:text-stone-500 text-xs">→</span>
										<span className="text-stone-700 dark:text-stone-300 text-sm">
											{value}
										</span>
									</div>
								))}
							</div>
						) : (
							<span className="text-xs text-stone-400 dark:text-stone-500 italic">None</span>
						)}
					</div>

					{/* Content — Write/Preview tabs */}
					<div className="flex flex-col gap-2 flex-1">
						<label className="text-xs font-medium text-stone-500 dark:text-stone-400">
							Content
						</label>
						{isEditing ? (
							<Tabs defaultValue="write" className="flex flex-col flex-1">
								<TabsList className="grid w-48 grid-cols-2 bg-stone-100 dark:bg-stone-900 self-start">
									<TabsTrigger
										value="write"
										className="data-[state=active]:bg-primary data-[state=active]:text-stone-50 text-stone-700 dark:text-stone-300 text-xs"
									>
										Write
									</TabsTrigger>
									<TabsTrigger
										value="preview"
										className="data-[state=active]:bg-primary data-[state=active]:text-stone-50 text-stone-700 dark:text-stone-300 text-xs"
									>
										Preview
									</TabsTrigger>
								</TabsList>
								<TabsContent value="write" className="flex-1 mt-2">
									<Textarea
										value={editContent}
										onChange={(e) => setEditContent(e.target.value)}
										placeholder="Write your context content in markdown..."
										className="min-h-[280px] h-full font-mono text-sm resize-none bg-white dark:bg-stone-900 border-stone-200 dark:border-stone-700 dark:text-stone-100 dark:placeholder:text-stone-500"
									/>
								</TabsContent>
								<TabsContent value="preview" className="mt-2">
									<div className="min-h-[280px] p-4 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-md overflow-y-auto scrollbar-hidden">
										{editContent ? (
											<div className="prose prose-sm dark:prose-invert max-w-none prose-stone prose-headings:font-semibold prose-code:rounded prose-code:px-1 prose-pre:bg-stone-100 dark:prose-pre:bg-stone-800">
												<ReactMarkdown>{editContent}</ReactMarkdown>
											</div>
										) : (
											<p className="text-sm text-stone-400 dark:text-stone-600 italic">
												Nothing to preview yet.
											</p>
										)}
									</div>
								</TabsContent>
							</Tabs>
						) : (
							<div className="flex-1 min-h-[200px] bg-stone-50 dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-md p-4 overflow-y-auto scrollbar-hidden">
								{ctx.content ? (
									<div className="prose prose-sm dark:prose-invert max-w-none prose-stone prose-headings:font-semibold prose-code:rounded prose-code:px-1 prose-pre:bg-stone-100 dark:prose-pre:bg-stone-800">
										<ReactMarkdown>{ctx.content}</ReactMarkdown>
									</div>
								) : (
									<p className="text-sm text-stone-400 dark:text-stone-600 italic">
										No content yet. Click Edit to add content.
									</p>
								)}
							</div>
						)}
					</div>
				</CardContent>
			</Card>

			{/* Right: Rules */}
			<Card className="flex flex-col overflow-hidden border border-stone-200 dark:border-stone-800">
				<CardHeader className="p-4 pb-3 border-b border-stone-100 dark:border-stone-800 flex-shrink-0">
					<div className="flex items-center justify-between">
						<CardTitle className="text-base text-stone-800 dark:text-stone-200">
							Rules
						</CardTitle>
						<RuleForm
							entityId={contextId}
							entityType="context"
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
									className="flex items-center justify-between p-3 rounded-md border border-stone-200 dark:border-stone-700 hover:border-stone-300 dark:hover:border-stone-600 hover:bg-stone-50 dark:hover:bg-stone-800/50 transition-colors group"
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

					<div className="flex flex-col gap-2 pt-2 border-t border-stone-100 dark:border-stone-800">
						<button
							type="button"
							onClick={() => setIsLinking((v) => !v)}
							className="flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 transition-colors self-start"
						>
							<LinkIcon className="w-3 h-3" />
							{isLinking ? "Cancel" : "Link existing rule"}
						</button>
						{isLinking && (
							<div className="flex flex-col gap-2">
								<Select value={selectedRuleId} onValueChange={setSelectedRuleId}>
									<SelectTrigger className="h-8 text-sm border-stone-300 dark:border-stone-600">
										<SelectValue placeholder="Select a rule..." />
									</SelectTrigger>
									<SelectContent>
										{unlinkdRules.length === 0 ? (
											<div className="px-3 py-2 text-xs text-stone-400 dark:text-stone-500">
												All rules already linked
											</div>
										) : (
											unlinkdRules.map((rule: any) => (
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
			</Card>
		</div>
	);
}
