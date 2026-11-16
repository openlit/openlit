"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Sparkles, Info } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { usePostHog } from "posthog-js/react";
import { CLIENT_EVENTS } from "@/constants/events";
import FeaturePageHeader from "@/components/(playground)/feature-page-header";
import getMessage from "@/constants/messages";

const EVALUATORS_HREF = "/evaluations?tab=evaluators";

export default function CreateCustomEvaluationTypePage() {
	const m = getMessage();
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
			toast.error(m.EVALUATION_TYPE_ID_REQUIRED);
			return;
		}
		if (!label.trim()) {
			toast.error(m.EVALUATION_TYPE_LABEL_REQUIRED);
			return;
		}
		if (!prompt.trim()) {
			toast.error(m.EVALUATION_TYPE_PROMPT_REQUIRED);
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
					toast.error(m.EVALUATION_TYPE_ID_EXISTS);
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
						// Preserve per-type thresholds across create-and-replace.
						// POST /api/evaluation/types replaces the full meta list;
						// omitting thresholdScore would wipe every saved override.
						thresholdScore: t.thresholdScore,
					})),
					{
						id,
						enabled: true,
						isCustom: true,
						label: label.trim(),
						description: description.trim() || m.EVALUATION_TYPE_CUSTOM_DEFAULT_DESCRIPTION,
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
						toast.success(m.EVALUATION_TYPE_CREATED(label.trim()));
						router.push(`/evaluations/types/${id}`);
					},
					failureCb: (err?: string) =>
						toast.error(err || m.EVALUATION_TYPE_CREATE_FAILED),
				});
			},
			failureCb: (err?: string) =>
				toast.error(err || m.EVALUATION_TYPE_LOAD_EXISTING_FAILED),
		});
	};

	return (
		<div className="flex h-full w-full flex-col overflow-hidden">
			<FeaturePageHeader
				eyebrow={m.FEATURE_EVALS}
				title={m.EVALUATION_TYPE_CREATE_TITLE}
				icon={<Sparkles className="h-4 w-4" />}
				tone="border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900/70 dark:bg-orange-950/40 dark:text-orange-300"
				leading={
					<Button
						asChild
						variant="outline"
						size="sm"
						className="h-8 w-8 shrink-0 p-0"
					>
						<Link
							href={EVALUATORS_HREF}
							title={m.EVALUATION_BACK_TO_TYPES}
							aria-label={m.EVALUATION_BACK_TO_TYPES}
						>
							<ArrowLeft className="h-3.5 w-3.5" />
						</Link>
					</Button>
				}
				actions={
					<Button
						onClick={handleCreate}
						disabled={isSaving}
						size="sm"
						className={`h-8 ${isSaving ? "animate-pulse" : ""}`}
					>
						{isSaving ? m.CREATING : m.EVALUATION_TYPE_CREATE_ACTION}
					</Button>
				}
			/>

			<div className="grid flex-1 grid-cols-1 content-start gap-4 overflow-auto p-4 lg:grid-cols-3">
				<div className="flex flex-col gap-4 lg:col-span-2">
					{/* Type ID & Label */}
					<Card className="border border-stone-200 dark:border-stone-800">
						<CardHeader className="p-4 pb-2">
							<CardTitle className="text-sm font-medium text-stone-700 dark:text-stone-300">
								{m.EVALUATION_TYPE_DETAILS_TITLE}
							</CardTitle>
						</CardHeader>
						<CardContent className="flex flex-col gap-4 p-4 pt-0">
							<div className="grid gap-2">
								<Label htmlFor="type-id" className="text-stone-700 dark:text-stone-300">
									{m.EVALUATION_TYPE_ID_LABEL}
								</Label>
								<Input
									id="type-id"
									placeholder={m.EVALUATION_TYPE_ID_PLACEHOLDER}
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
									{m.EVALUATION_TYPE_ID_HELP}
								</p>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="type-label" className="text-stone-700 dark:text-stone-300">
									{m.EVALUATION_TYPE_LABEL_LABEL}
								</Label>
								<Input
									id="type-label"
									placeholder={m.EVALUATION_TYPE_LABEL_PLACEHOLDER}
									value={label}
									onChange={(e) => setLabel(e.target.value)}
								/>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="type-description" className="text-stone-700 dark:text-stone-300">
									{m.DESCRIPTION}
								</Label>
								<Input
									id="type-description"
									placeholder={m.EVALUATION_TYPE_DESCRIPTION_PLACEHOLDER}
									value={description}
									onChange={(e) => setDescription(e.target.value)}
								/>
							</div>
						</CardContent>
					</Card>

					{/* Evaluation Prompt */}
					<Card className="border border-stone-200 dark:border-stone-800">
						<CardHeader className="p-4 pb-2">
							<CardTitle className="text-sm font-medium text-stone-700 dark:text-stone-300">
								{m.EVALUATION_TYPE_PROMPT_TITLE}
							</CardTitle>
							<p className="text-xs font-normal text-stone-500 dark:text-stone-400">
								{m.EVALUATION_TYPE_PROMPT_HELP}
							</p>
						</CardHeader>
						<CardContent className="p-4 pt-0">
							<Textarea
								id="type-prompt"
								aria-label={m.EVALUATION_TYPE_PROMPT_TITLE}
								className="min-h-[200px] resize-y font-mono"
								placeholder={m.EVALUATION_TYPE_PROMPT_PLACEHOLDER}
								value={prompt}
								onChange={(e) => setPrompt(e.target.value)}
							/>
						</CardContent>
					</Card>
				</div>

				{/* Sidebar */}
				<div className="flex flex-col gap-4">
					<Card className="border border-stone-200 dark:border-stone-800">
						<CardHeader className="p-4 pb-2">
							<CardTitle className="flex items-center gap-2 text-sm font-medium text-stone-700 dark:text-stone-300">
								<Info className="size-4 shrink-0 text-stone-500 dark:text-stone-400" />
								{m.EVALUATION_TYPE_HOW_IT_WORKS_TITLE}
							</CardTitle>
						</CardHeader>
						<CardContent className="flex flex-col gap-2 p-4 pt-0 text-xs text-stone-500 dark:text-stone-400">
							<p>{m.EVALUATION_TYPE_HOW_IT_WORKS_BUILT_IN}</p>
							<p>{m.EVALUATION_TYPE_HOW_IT_WORKS_RULES}</p>
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	);
}
