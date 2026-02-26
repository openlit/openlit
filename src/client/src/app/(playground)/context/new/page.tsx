"use client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { usePageHeader } from "@/selectors/page";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { ArrowLeftIcon, PlusIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { KeyboardEvent, useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";

export default function NewContextPage() {
	const router = useRouter();
	const { setHeader } = usePageHeader();
	const { fireRequest, isLoading } = useFetchWrapper();

	const [name, setName] = useState("");
	const [content, setContent] = useState("");
	const [description, setDescription] = useState("");
	const [status, setStatus] = useState<"ACTIVE" | "INACTIVE">("ACTIVE");
	const [tags, setTags] = useState<string[]>([]);
	const [tagInput, setTagInput] = useState("");
	const [metaProps, setMetaProps] = useState<{ key: string; value: string }[]>([]);

	useEffect(() => {
		setHeader({
			title: "Create Context",
			breadcrumbs: [{ title: "Contexts", href: "/context" }],
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
			toast.error("Context name is required", { id: "context-new" });
			return;
		}
		if (!content.trim()) {
			toast.error("Context content is required", { id: "context-new" });
			return;
		}
		toast.loading("Creating context...", { id: "context-new" });

		const metaProperties = metaProps.reduce(
			(acc: Record<string, string>, { key, value }) => {
				if (key.trim()) acc[key.trim()] = value;
				return acc;
			},
			{}
		);

		const payload = {
			name: name.trim(),
			content,
			description: description.trim(),
			status,
			tags: JSON.stringify(tags),
			meta_properties: JSON.stringify(metaProperties),
		};

		fireRequest({
			body: JSON.stringify(payload),
			requestType: "POST",
			url: "/api/context",
			successCb: (response: any) => {
				toast.success("Context created successfully!", { id: "context-new" });
				if (response?.id) {
					router.push(`/context/${response.id}`);
				} else {
					router.push("/context");
				}
			},
			failureCb: (err?: string) => {
				toast.error(err || "Failed to create context", { id: "context-new" });
			},
		});
	}, [name, content, description, status, tags, metaProps]);

	return (
		<div className="flex flex-col w-full h-full gap-4 overflow-hidden">
			{/* Topbar */}
			<div className="flex items-center justify-between flex-shrink-0">
				<Link
					href="/context"
					className="flex items-center gap-1.5 text-sm text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200 transition-colors"
				>
					<ArrowLeftIcon className="w-4 h-4" />
					Back to Contexts
				</Link>
				<Button
					onClick={handleSubmit}
					disabled={isLoading}
					className={isLoading ? "animate-pulse" : ""}
				>
					Save Context
				</Button>
			</div>

			{/* Body */}
			<div className="grid grid-cols-3 gap-4 flex-1 overflow-hidden">
				{/* Left: name + description + markdown editor */}
				<Card className="col-span-2 flex flex-col overflow-hidden border border-stone-200 dark:border-stone-800">
					<CardContent className="flex flex-col gap-4 p-4 flex-1 overflow-hidden">
						{/* Name */}
						<div className="flex flex-col gap-1.5 flex-shrink-0">
							<Label className="text-sm font-medium text-stone-700 dark:text-stone-300">
								Name
							</Label>
							<Input
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="My Context"
								className="border-stone-300 dark:border-stone-600"
							/>
						</div>

						{/* Description */}
						<div className="flex flex-col gap-1.5 flex-shrink-0">
							<Label className="text-sm font-medium text-stone-700 dark:text-stone-300">
								Description
								<span className="text-stone-400 dark:text-stone-500 font-normal ml-1 text-xs">
									(optional)
								</span>
							</Label>
							<Input
								value={description}
								onChange={(e) => setDescription(e.target.value)}
								placeholder="Optional description"
								className="border-stone-300 dark:border-stone-600"
							/>
						</div>

						{/* Markdown editor */}
						<div className="flex flex-col gap-2 flex-1 overflow-hidden">
							<Label className="text-sm font-medium text-stone-700 dark:text-stone-300">
								Content
							</Label>
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
										value={content}
										onChange={(e) => setContent(e.target.value)}
										placeholder="Write your context content here. Markdown is supported."
										className="h-full min-h-[300px] resize-none font-mono text-sm bg-white dark:bg-stone-900 border-stone-200 dark:border-stone-800 dark:text-stone-100 dark:placeholder:text-stone-500"
									/>
								</TabsContent>
								<TabsContent value="preview" className="flex-1 overflow-auto mt-2">
									<div className="min-h-[300px] h-full bg-stone-50 dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-md p-4 overflow-auto scrollbar-hidden">
										{content ? (
											<div className="prose prose-sm dark:prose-invert max-w-none prose-stone prose-headings:font-semibold prose-code:rounded prose-code:px-1 prose-pre:bg-stone-100 dark:prose-pre:bg-stone-800">
												<ReactMarkdown>{content}</ReactMarkdown>
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
					{/* Status */}
					<Card className="border border-stone-200 dark:border-stone-800 flex-shrink-0">
						<CardHeader className="p-4 pb-2">
							<CardTitle className="text-sm font-medium text-stone-700 dark:text-stone-300">
								Status
							</CardTitle>
						</CardHeader>
						<CardContent className="p-4 pt-0">
							<Select
								value={status}
								onValueChange={(v) => setStatus(v as "ACTIVE" | "INACTIVE")}
							>
								<SelectTrigger className="border-stone-300 dark:border-stone-600">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="ACTIVE">Active</SelectItem>
									<SelectItem value="INACTIVE">Inactive</SelectItem>
								</SelectContent>
							</Select>
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
