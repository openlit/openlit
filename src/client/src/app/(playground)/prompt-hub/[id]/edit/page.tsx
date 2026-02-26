"use client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { CLIENT_EVENTS } from "@/constants/events";
import { usePageHeader } from "@/selectors/page";
import { Prompt, PromptVersion, PromptVersionStatus } from "@/types/prompt";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { jsonParse } from "@/utils/json";
import { objectEntries } from "@/utils/object";
import { unescapeString } from "@/utils/string";
import { ArrowLeftIcon, PlusIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { KeyboardEvent, useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";

const getVersions = (startingVersion: string) => {
	const v = startingVersion.split(".").map(Number);
	return {
		draft: startingVersion,
		major: [v[0] + 1, 0, 0].join("."),
		minor: [v[0], v[1] + 1, 0].join("."),
		patch: [v[0], v[1], v[2] + 1].join("."),
	};
};

export default function EditPromptPage() {
	const router = useRouter();
	const posthog = usePostHog();
	const params = useParams();
	const { setHeader } = usePageHeader();

	const { fireRequest: fetchReq, data: promptData, isLoading: isFetching } =
		useFetchWrapper<Prompt>();
	const { fireRequest: saveReq, isLoading: isSaving } = useFetchWrapper();

	const [promptText, setPromptText] = useState("");
	const [tags, setTags] = useState<string[]>([]);
	const [tagInput, setTagInput] = useState("");
	const [metaProps, setMetaProps] = useState<{ key: string; value: string }[]>([]);
	const [selectedVersion, setSelectedVersion] = useState("");
	const [versionOptions, setVersionOptions] = useState<
		{ value: string; title: string; subText: string; description: string }[]
	>([]);
	const [versionData, setVersionData] = useState<any>(null);

	// Fetch the prompt data
	useEffect(() => {
		fetchReq({
			requestType: "GET",
			url: `/api/prompt/get/${params.id}`,
			responseDataKey: "data.[0]",
			failureCb: (err?: string) => {
				toast.error(err || "Failed to load prompt", { id: "prompt-edit" });
			},
		});
	}, [params.id]);

	// Once data is loaded, initialise state
	useEffect(() => {
		if (!promptData) return;
		const d = promptData as any;

		// Prefer the draft version for editing; fall back to latest published
		const draft = d.versions?.find(
			(v: PromptVersion) => v.status === PromptVersionStatus.DRAFT
		);
		const latest = d.versions?.find(
			(v: PromptVersion) => v.status !== PromptVersionStatus.DRAFT
		);
		const active = draft || latest || d;

		setVersionData(active);

		setPromptText(unescapeString(active.prompt || ""));

		const parsedTags = jsonParse(active.tags) || [];
		setTags(Array.isArray(parsedTags) ? parsedTags : []);

		const parsedMeta = jsonParse(active.metaProperties) || {};
		setMetaProps(
			objectEntries(parsedMeta).map(([k, v]: string[]) => ({ key: k, value: v as string }))
		);

		const versions = getVersions(active.version || "0.0.0");
		const opts = [
			{
				value: versions.draft,
				title: "Draft",
				subText: "No version change",
				description: "Keep as draft — not published",
			},
			{
				value: versions.major,
				title: "Major",
				subText: `v${versions.major}`,
				description: "Significant changes, not backwards compatible",
			},
			{
				value: versions.minor,
				title: "Minor",
				subText: `v${versions.minor}`,
				description: "New features, backwards compatible",
			},
			{
				value: versions.patch,
				title: "Patch",
				subText: `v${versions.patch}`,
				description: "Bug fixes and minor updates",
			},
		];
		setVersionOptions(opts);
		setSelectedVersion(versions.draft);

		setHeader({
			title: d.name,
			breadcrumbs: [
				{ title: "Prompt Hub", href: "/prompt-hub" },
				{ title: d.name, href: `/prompt-hub/${params.id}` },
			],
		});
	}, [(promptData as any)?.promptId]);

	const addTag = useCallback(() => {
		const val = tagInput.trim();
		if (val && !tags.includes(val)) setTags((prev) => [...prev, val]);
		setTagInput("");
	}, [tagInput, tags]);

	const removeTag = (tag: string) => setTags((prev) => prev.filter((t) => t !== tag));

	const addMetaProp = () =>
		setMetaProps((prev) => [...prev, { key: "", value: "" }]);
	const removeMetaProp = (idx: number) =>
		setMetaProps((prev) => prev.filter((_, i) => i !== idx));
	const updateMetaProp = (idx: number, field: "key" | "value", val: string) =>
		setMetaProps((prev) =>
			prev.map((p, i) => (i === idx ? { ...p, [field]: val } : p))
		);

	const handleSubmit = useCallback(() => {
		if (!promptText.trim()) {
			toast.error("Prompt content is required", { id: "prompt-edit" });
			return;
		}
		if (!versionData) return;

		toast.loading("Saving...", { id: "prompt-edit" });

		const metaProperties = metaProps.reduce(
			(acc: Record<string, string>, { key, value }) => {
				if (key.trim()) acc[key.trim()] = value;
				return acc;
			},
			{}
		);

		const isKeepingDraftVersion = selectedVersion === versionData.version;

		const payload: Record<string, any> = {
			promptId: versionData.promptId,
			prompt: promptText,
			version: selectedVersion,
			status: isKeepingDraftVersion ? "DRAFT" : "PUBLISHED",
			tags,
			metaProperties,
		};

		// If editing an existing draft, carry its versionId so it updates in place
		if (versionData.status === PromptVersionStatus.DRAFT) {
			payload.versionId = versionData.versionId;
		}

		saveReq({
			body: JSON.stringify(payload),
			requestType: "POST",
			url: "/api/prompt/version",
			successCb: (response: any) => {
				toast.success("Prompt saved!", { id: "prompt-edit" });
				posthog?.capture(CLIENT_EVENTS.PROMPT_VERSION_ADD_SUCCESS);
				const promptId = response?.data?.promptId;
				const version = payload.version;
				if (promptId) {
					router.push(
						`/prompt-hub/${promptId}${isKeepingDraftVersion ? "" : `?version=${version}`}`
					);
				} else {
					router.push(`/prompt-hub/${params.id}`);
				}
			},
			failureCb: (err?: string) => {
				toast.error(err || "Failed to save prompt", { id: "prompt-edit" });
				posthog?.capture(CLIENT_EVENTS.PROMPT_VERSION_ADD_FAILURE);
			},
		});
	}, [promptText, tags, metaProps, selectedVersion, versionData]);

	if (isFetching && !promptData) {
		return (
			<div className="flex flex-col w-full h-full overflow-hidden gap-4 items-center justify-center">
				<div className="h-4 w-1/5 bg-stone-200 dark:bg-stone-700 rounded animate-pulse" />
				<div className="h-4 w-3/5 bg-stone-200 dark:bg-stone-700 rounded animate-pulse" />
				<div className="h-4 w-2/3 bg-stone-200 dark:bg-stone-700 rounded animate-pulse" />
			</div>
		);
	}

	if (!promptData) return null;

	const promptName = (promptData as any).name;
	const isDraft = versionData?.status === PromptVersionStatus.DRAFT;

	return (
		<div className="flex flex-col w-full h-full gap-4 overflow-hidden">
			{/* Topbar */}
			<div className="flex items-center justify-between flex-shrink-0">
				<Link
					href={`/prompt-hub/${params.id}`}
					className="flex items-center gap-1.5 text-sm text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200 transition-colors"
				>
					<ArrowLeftIcon className="w-4 h-4" />
					Back to {promptName}
				</Link>
				<Button
					onClick={handleSubmit}
					disabled={isSaving || isFetching}
					className={isSaving ? "animate-pulse" : ""}
				>
					{isSaving ? "Saving..." : "Save"}
				</Button>
			</div>

			{/* Body */}
			<div className="grid grid-cols-3 gap-4 flex-1 overflow-hidden">
				{/* Left: markdown editor */}
				<Card className="col-span-2 flex flex-col overflow-hidden border border-stone-200 dark:border-stone-800">
					<CardHeader className="p-4 pb-2 border-b border-stone-200 dark:border-stone-800 flex-shrink-0">
						<div className="flex items-center gap-3">
							<CardTitle className="text-lg text-stone-900 dark:text-stone-100">
								{promptName}
							</CardTitle>
							{isDraft && (
								<Badge variant="secondary" className="text-xs">
									Draft
								</Badge>
							)}
						</div>
						<p className="text-xs text-stone-400 dark:text-stone-500 mt-1">
							{isDraft
								? "Editing draft — publish when ready"
								: "Creating a new version from the latest published"}
						</p>
					</CardHeader>
					<CardContent className="flex flex-col gap-3 p-4 flex-1 overflow-hidden">
						<div className="flex items-center justify-between flex-shrink-0">
							<Label className="text-sm font-medium text-stone-700 dark:text-stone-300">
								Prompt
							</Label>
							<span className="text-xs text-stone-400 dark:text-stone-500">
								Use {`{{variableName}}`} for dynamic variables
							</span>
						</div>
						<Tabs defaultValue="write" className="flex flex-col flex-1 overflow-hidden">
							<TabsList className="grid w-48 grid-cols-2 bg-stone-100 dark:bg-stone-900 self-start flex-shrink-0">
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
							<TabsContent value="write" className="flex-1 overflow-hidden mt-2">
								<Textarea
									value={promptText}
									onChange={(e) => setPromptText(e.target.value)}
									placeholder="Write your prompt here. Use {{variable}} for dynamic content."
									className="h-full min-h-[300px] resize-none font-mono text-sm bg-white dark:bg-stone-900 border-stone-200 dark:border-stone-800 dark:text-stone-100 dark:placeholder:text-stone-500"
								/>
							</TabsContent>
							<TabsContent value="preview" className="flex-1 overflow-auto mt-2">
								<div className="min-h-[300px] h-full bg-stone-50 dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-md p-4 overflow-auto scrollbar-hidden">
									{promptText ? (
										<div className="prose prose-sm dark:prose-invert max-w-none prose-stone prose-headings:font-semibold prose-code:rounded prose-code:px-1 prose-pre:bg-stone-100 dark:prose-pre:bg-stone-800">
											<ReactMarkdown>{promptText}</ReactMarkdown>
										</div>
									) : (
										<p className="text-sm text-stone-400 dark:text-stone-600 italic">
											Nothing to preview yet.
										</p>
									)}
								</div>
							</TabsContent>
						</Tabs>
					</CardContent>
				</Card>

				{/* Right: settings */}
				<div className="flex flex-col gap-4 overflow-y-auto scrollbar-hidden">
					{/* Version picker */}
					<Card className="border border-stone-200 dark:border-stone-800 flex-shrink-0">
						<CardHeader className="p-4 pb-2">
							<CardTitle className="text-sm font-medium text-stone-700 dark:text-stone-300">
								Version
							</CardTitle>
						</CardHeader>
						<CardContent className="p-4 pt-0 flex flex-col gap-2">
							<div className="grid grid-cols-2 gap-2">
								{versionOptions.map((opt) => (
									<button
										key={opt.value}
										type="button"
										onClick={() => setSelectedVersion(opt.value)}
										className={`text-left p-3 rounded-md border transition-colors ${
											selectedVersion === opt.value
												? "border-primary bg-primary/5 dark:bg-primary/10"
												: "border-stone-200 dark:border-stone-700 hover:border-stone-300 dark:hover:border-stone-600"
										}`}
									>
										<div className="text-sm font-medium text-stone-800 dark:text-stone-200">
											{opt.title}
										</div>
										<div className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
											{opt.subText}
										</div>
									</button>
								))}
							</div>
							{selectedVersion && (
								<p className="text-xs text-stone-400 dark:text-stone-500 mt-1">
									{versionOptions.find((o) => o.value === selectedVersion)?.description}
								</p>
							)}
						</CardContent>
					</Card>

					{/* Tags */}
					<Card className="border border-stone-200 dark:border-stone-800 flex-shrink-0">
						<CardHeader className="p-4 pb-2">
							<CardTitle className="text-sm font-medium text-stone-700 dark:text-stone-300">
								Tags
							</CardTitle>
						</CardHeader>
						<CardContent className="p-4 pt-0 flex flex-col gap-2">
							<div className="flex gap-2">
								<Input
									value={tagInput}
									onChange={(e) => setTagInput(e.target.value)}
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
							{tags.length > 0 && (
								<div className="flex flex-wrap gap-1.5 mt-1">
									{tags.map((tag) => (
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
						</CardContent>
					</Card>

					{/* Meta Properties */}
					<Card className="border border-stone-200 dark:border-stone-800 flex-shrink-0">
						<CardHeader className="p-4 pb-2">
							<CardTitle className="text-sm font-medium text-stone-700 dark:text-stone-300">
								Meta Properties
							</CardTitle>
						</CardHeader>
						<CardContent className="p-4 pt-0 flex flex-col gap-2">
							{metaProps.map((prop, idx) => (
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
								className="border-stone-300 dark:border-stone-600 text-stone-600 dark:text-stone-400 mt-1"
							>
								<PlusIcon className="w-3.5 h-3.5 mr-1" />
								Add property
							</Button>
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	);
}
