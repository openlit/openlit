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
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { ArrowLeftIcon, PlusIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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

const VERSION_OPTIONS = (versions: ReturnType<typeof getVersions>) => [
	{
		value: versions.draft,
		title: "Draft",
		subText: "No version assigned",
		description: "Save as a draft — not yet published",
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

export default function NewPromptPage() {
	const router = useRouter();
	const posthog = usePostHog();
	const { setHeader } = usePageHeader();
	const { fireRequest, isLoading } = useFetchWrapper();

	const versions = getVersions("0.0.0");
	const versionOptions = VERSION_OPTIONS(versions);

	const [name, setName] = useState("");
	const [promptText, setPromptText] = useState("");
	const [tags, setTags] = useState<string[]>([]);
	const [tagInput, setTagInput] = useState("");
	const [metaProps, setMetaProps] = useState<{ key: string; value: string }[]>([]);
	const [selectedVersion, setSelectedVersion] = useState(versions.draft);

	useEffect(() => {
		setHeader({
			title: "Create Prompt",
			breadcrumbs: [{ title: "Prompt Hub", href: "/prompt-hub" }],
		});
	}, []);

	const addTag = useCallback(() => {
		const val = tagInput.trim();
		if (val && !tags.includes(val)) {
			setTags((prev) => [...prev, val]);
		}
		setTagInput("");
	}, [tagInput, tags]);

	const removeTag = (tag: string) => setTags((prev) => prev.filter((t) => t !== tag));

	const addMetaProp = () => setMetaProps((prev) => [...prev, { key: "", value: "" }]);
	const removeMetaProp = (idx: number) =>
		setMetaProps((prev) => prev.filter((_, i) => i !== idx));
	const updateMetaProp = (idx: number, field: "key" | "value", val: string) =>
		setMetaProps((prev) => prev.map((p, i) => (i === idx ? { ...p, [field]: val } : p)));

	const handleSubmit = useCallback(() => {
		if (!name.trim()) {
			toast.error("Prompt name is required", { id: "prompt-new" });
			return;
		}
		if (!promptText.trim()) {
			toast.error("Prompt content is required", { id: "prompt-new" });
			return;
		}
		toast.loading("Creating prompt...", { id: "prompt-new" });

		const metaProperties = metaProps.reduce(
			(acc: Record<string, string>, { key, value }) => {
				if (key.trim()) acc[key.trim()] = value;
				return acc;
			},
			{}
		);

		const payload = {
			name: name.trim(),
			prompt: promptText,
			version: selectedVersion,
			status: selectedVersion === versions.draft ? "DRAFT" : "PUBLISHED",
			tags,
			metaProperties,
		};

		fireRequest({
			body: JSON.stringify(payload),
			requestType: "POST",
			url: "/api/prompt",
			successCb: (response: any) => {
				toast.success("Prompt created successfully!", { id: "prompt-new" });
				posthog?.capture(CLIENT_EVENTS.PROMPT_ADD_SUCCESS);
				if (response?.data?.promptId) {
					router.push(`/prompt-hub/${response.data.promptId}`);
				} else {
					router.push("/prompt-hub");
				}
			},
			failureCb: (err?: string) => {
				toast.error(err || "Failed to create prompt", { id: "prompt-new" });
				posthog?.capture(CLIENT_EVENTS.PROMPT_ADD_FAILURE);
			},
		});
	}, [name, promptText, tags, metaProps, selectedVersion]);

	return (
		<div className="flex flex-col w-full h-full gap-4 overflow-hidden">
			{/* Topbar */}
			<div className="flex items-center justify-between flex-shrink-0">
				<Link
					href="/prompt-hub"
					className="flex items-center gap-1.5 text-sm text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200 transition-colors"
				>
					<ArrowLeftIcon className="w-4 h-4" />
					Back to Prompt Hub
				</Link>
				<Button
					onClick={handleSubmit}
					disabled={isLoading}
					className={isLoading ? "animate-pulse" : ""}
				>
					Save Prompt
				</Button>
			</div>

			{/* Body */}
			<div className="grid grid-cols-3 gap-4 flex-1 overflow-hidden">
				{/* Left: name + markdown editor */}
				<Card className="col-span-2 flex flex-col overflow-hidden border border-stone-200 dark:border-stone-800">
					<CardContent className="flex flex-col gap-4 p-4 flex-1 overflow-hidden">
						{/* Name */}
						<div className="flex flex-col gap-1.5 flex-shrink-0">
							<Label className="text-sm font-medium text-stone-700 dark:text-stone-300">
								Name
								<span className="text-stone-400 dark:text-stone-500 font-normal ml-1 text-xs">
									(lowercase letters and _ only)
								</span>
							</Label>
							<Input
								value={name}
								onChange={(e) => {
									let v = e.target.value.toLowerCase().replace(/ /g, "_").replace(/[^a-z_]/g, "");
									setName(v);
								}}
								placeholder="my_prompt"
								className="border-stone-300 dark:border-stone-600"
							/>
						</div>

						{/* Markdown editor */}
						<div className="flex flex-col gap-2 flex-1 overflow-hidden">
							<div className="flex items-center justify-between">
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
						</div>
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
							<p className="text-xs text-stone-400 dark:text-stone-500 mt-1">
								{versionOptions.find((o) => o.value === selectedVersion)?.description}
							</p>
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
											<button type="button" onClick={() => removeTag(tag)} className="ml-0.5 hover:text-red-500">
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
