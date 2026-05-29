"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Sparkles, Info } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { usePostHog } from "posthog-js/react";
import { CLIENT_EVENTS } from "@/constants/events";

export default function CreateCustomEvaluationTypePage() {
	const posthog = usePostHog();
	const router = useRouter();
	const [typeId, setTypeId] = useState("");
	const [label, setLabel] = useState("");
	const [description, setDescription] = useState("");
	const [prompt, setPrompt] = useState("");

	const { fireRequest: getTypes } = useFetchWrapper();
	const { fireRequest: saveTypes, isLoading: isSaving } = useFetchWrapper();

	useEffect(() => {
		posthog?.capture(CLIENT_EVENTS.EVALUATION_TYPE_NEW_PAGE_VISITED);
	}, []);

	const handleCreate = async () => {
		const id = typeId.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
		if (!id) {
			toast.error("Type ID is required");
			return;
		}
		if (!label.trim()) {
			toast.error("Label is required");
			return;
		}
		if (!prompt.trim()) {
			toast.error("Evaluation prompt is required");
			return;
		}

		// Fetch existing types to append to
		getTypes({
			requestType: "GET",
			url: "/api/evaluation/types",
			responseDataKey: "data",
			successCb: (existing: any) => {
				const existingTypes = Array.isArray(existing) ? existing : [];
				if (existingTypes.some((t: any) => t.id === id)) {
					toast.error("An evaluation type with this ID already exists");
					return;
				}

				const updatedTypes = [
					...existingTypes.map((t: any) => ({
						id: t.id,
						enabled: t.enabled,
						isCustom: t.isCustom,
						label: t.isCustom ? t.label : undefined,
						description: t.isCustom ? t.description : undefined,
						prompt: t.prompt,
						rules: t.rules,
					})),
					{
						id,
						enabled: true,
						isCustom: true,
						label: label.trim(),
						description: description.trim() || "Custom evaluation type",
						prompt: prompt.trim(),
						rules: [],
					},
				];

				saveTypes({
					requestType: "POST",
					url: "/api/evaluation/types",
					body: JSON.stringify({ types: updatedTypes }),
					responseDataKey: "data",
					successCb: () => {
						toast.success(`Custom evaluation type "${label.trim()}" created`);
						router.push(`/evaluations/types/${id}`);
					},
					failureCb: (err?: string) =>
						toast.error(err || "Failed to create custom type"),
				});
			},
			failureCb: (err?: string) =>
				toast.error(err || "Failed to load existing types"),
		});
	};

	return (
		<div className="flex flex-col flex-1 h-full w-full p-6 overflow-auto gap-6">
			{/* Header */}
			<div className="flex items-center gap-4">
				<Link href="/evaluations/types">
					<Button
						variant="outline"
						size="icon"
						className="shrink-0 text-stone-700 dark:text-stone-200 border-stone-300 dark:border-stone-600 hover:bg-stone-100 dark:hover:bg-stone-800"
					>
						<ArrowLeft className="size-4" />
					</Button>
				</Link>
				<div>
					<h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100 flex items-center gap-2">
						<Sparkles className="size-5 text-primary" />
						Create Custom Evaluation Type
					</h2>
					<p className="text-sm text-stone-500 dark:text-stone-400">
						Define a custom evaluation type with your own prompt. The LLM judge will use it to evaluate traces.
					</p>
				</div>
			</div>

			<div className="grid grid-cols-3 gap-4">
				<div className="col-span-2 space-y-4">
					{/* Type ID & Label */}
					<Card className="border-stone-200 dark:border-stone-800 shadow-sm">
						<CardHeader className="pb-2">
							<CardTitle className="text-base text-stone-900 dark:text-stone-100">Type Details</CardTitle>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="grid gap-2">
								<Label htmlFor="type-id" className="text-stone-700 dark:text-stone-300">Type ID</Label>
								<Input
									id="type-id"
									placeholder="e.g. domain_accuracy"
									value={typeId}
									onChange={(e) =>
										setTypeId(
											e.target.value
												.toLowerCase()
												.replace(/[^a-z0-9_]/g, "_")
										)
									}
								/>
								<p className="text-xs text-stone-500 dark:text-stone-400">
									Lowercase letters, numbers, and underscores only. Used as the internal identifier.
								</p>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="type-label" className="text-stone-700 dark:text-stone-300">Label</Label>
								<Input
									id="type-label"
									placeholder="e.g. Domain Accuracy"
									value={label}
									onChange={(e) => setLabel(e.target.value)}
								/>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="type-description" className="text-stone-700 dark:text-stone-300">Description</Label>
								<Input
									id="type-description"
									placeholder="e.g. Evaluates responses against domain-specific knowledge"
									value={description}
									onChange={(e) => setDescription(e.target.value)}
								/>
							</div>
						</CardContent>
					</Card>

					{/* Evaluation Prompt */}
					<Card className="border-stone-200 dark:border-stone-800 shadow-sm">
						<CardHeader className="pb-2">
							<CardTitle className="text-base text-stone-900 dark:text-stone-100">Evaluation Prompt</CardTitle>
							<p className="text-xs text-stone-500 dark:text-stone-400 font-normal">
								The LLM judge uses this prompt to evaluate each trace. Start with a [Label evaluation context] header.
							</p>
						</CardHeader>
						<CardContent>
							<textarea
								id="type-prompt"
								className="w-full min-h-[200px] text-sm bg-stone-50 dark:bg-stone-900/50 text-stone-900 dark:text-stone-100 p-3 rounded-lg border border-stone-200 dark:border-stone-700 font-mono resize-y placeholder:text-stone-400 dark:placeholder:text-stone-500 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50"
								placeholder={`[Domain Accuracy evaluation context]\nConsider: whether the response aligns with domain-specific knowledge and terminology.\nLook for incorrect use of domain terms, inaccurate domain-specific claims, and deviations from established domain practices.`}
								value={prompt}
								onChange={(e) => setPrompt(e.target.value)}
							/>
						</CardContent>
					</Card>
				</div>

				{/* Sidebar */}
				<div className="space-y-4">
					<Button
						onClick={handleCreate}
						disabled={isSaving}
						className="w-full bg-primary dark:bg-primary text-white dark:text-white hover:bg-primary/90 dark:hover:bg-primary/90"
					>
						{isSaving ? "Creating..." : "Create Evaluation Type"}
					</Button>

					<Card className="border-blue-200 dark:border-blue-900/40 bg-blue-50/50 dark:bg-blue-950/20 shadow-sm">
						<CardContent className="pt-4">
							<div className="flex gap-2">
								<Info className="size-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
								<div className="text-xs text-blue-900 dark:text-blue-100 space-y-2">
									<p className="font-medium">How it works</p>
									<p className="text-blue-700 dark:text-blue-300">
										Custom types run alongside built-in evaluations (hallucination, bias, toxicity, etc.). The LLM judge produces a score, classification, and explanation for each type.
									</p>
									<p className="text-blue-700 dark:text-blue-300">
										After creating, you can link Rule Engine rules to conditionally apply this evaluation based on trace attributes.
									</p>
								</div>
							</div>
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	);
}
