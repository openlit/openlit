"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import getMessage from "@/constants/messages";
import {
	CheckIcon,
	ChevronDownIcon,
	ChevronRightIcon,
	Loader2Icon,
	PlusIcon,
	SparklesIcon,
	XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { usePostHog } from "posthog-js/react";
import { CLIENT_EVENTS } from "@/constants/events";

const m = getMessage();

type PromptSuggestion = {
	id: string;
	dimension: string;
	rationale: string;
	original: string;
	replacement: string;
};

type ChangeState = "pending" | "accepted" | "declined";

type LocalChange = PromptSuggestion & {
	state: ChangeState;
	appliedAt?: string;
};

const DEFAULT_CRITERIA = [
	m.PROMPT_OTTER_CRITERIA_CONCISE,
	m.PROMPT_OTTER_CRITERIA_STRUCTURE,
	m.PROMPT_OTTER_CRITERIA_VARIABLES,
	m.PROMPT_OTTER_CRITERIA_OUTPUT,
	m.PROMPT_OTTER_CRITERIA_AMBIGUITY,
];

function replaceFirst(source: string, original: string, replacement: string) {
	const index = source.indexOf(original);
	if (index === -1) return source;
	return `${source.slice(0, index)}${replacement}${source.slice(index + original.length)}`;
}

export default function PromptOtterInlineAssistant({
	prompt,
	onApplyPrompt,
	storageKey,
	promptId,
	persistState = true,
}: {
	prompt: string;
	onApplyPrompt: (nextPrompt: string) => void;
	storageKey: string;
	promptId?: string;
	persistState?: boolean;
}) {
	const posthog = usePostHog();
	const [isOpen, setIsOpen] = useState(false);
	const [criteria, setCriteria] = useState<string[]>(DEFAULT_CRITERIA);
	const [continuation, setContinuation] = useState("");
	const [suggestions, setSuggestions] = useState<LocalChange[]>([]);
	const [expandedSuggestions, setExpandedSuggestions] = useState<Record<string, boolean>>({});
	const [isRunning, setIsRunning] = useState(false);

	useEffect(() => {
		if (!persistState) {
			window.localStorage.removeItem(storageKey);
			setCriteria(DEFAULT_CRITERIA);
			setContinuation("");
			setSuggestions([]);
			setExpandedSuggestions({});
			return;
		}
		try {
			const raw = window.localStorage.getItem(storageKey);
			if (!raw) return;
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed?.criteria)) {
				setCriteria(parsed.criteria.filter(Boolean));
			}
			if (typeof parsed?.continuation === "string") {
				setContinuation(parsed.continuation);
			}
			if (Array.isArray(parsed?.suggestions)) {
				setSuggestions(parsed.suggestions);
			}
			if (parsed?.expandedSuggestions && typeof parsed.expandedSuggestions === "object") {
				setExpandedSuggestions(parsed.expandedSuggestions);
			}
		} catch {
			// Ignore stale local assistant state.
		}
	}, [persistState, storageKey]);

	useEffect(() => {
		if (!persistState) return;
		window.localStorage.setItem(
			storageKey,
			JSON.stringify({ criteria, continuation, suggestions, expandedSuggestions })
		);
	}, [criteria, continuation, expandedSuggestions, persistState, storageKey, suggestions]);

	const pendingCount = useMemo(
		() => suggestions.filter((suggestion) => suggestion.state === "pending").length,
		[suggestions]
	);

	const addCriterion = useCallback(() => {
		const value = continuation.trim();
		if (!value) return;
		setCriteria((prev) => [...prev, value]);
		setContinuation("");
	}, [continuation]);

	const runAnalysis = useCallback(async () => {
		if (!prompt.trim()) {
			toast.error(m.PROMPT_OTTER_EMPTY_PROMPT);
			return;
		}
		const effectiveCriteria = continuation.trim()
			? [...criteria, continuation.trim()]
			: criteria;
		setIsRunning(true);
		try {
			const response = await fetch("/api/prompt/improve", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ prompt, criteria: effectiveCriteria, promptId }),
			});
			const payload = await response.json();
			if (!response.ok) {
				throw new Error(payload?.err || m.PROMPT_OTTER_ANALYSIS_FAILED);
			}
			const nextSuggestions = (payload?.data?.suggestions || []).map(
				(suggestion: PromptSuggestion, index: number) => ({
					...suggestion,
					id: suggestion.id || `suggestion-${index + 1}`,
					state: "pending" as ChangeState,
				})
			);
			setSuggestions(nextSuggestions);
			setExpandedSuggestions(
				nextSuggestions.reduce((acc: Record<string, boolean>, suggestion: LocalChange) => {
					acc[suggestion.id] = true;
					return acc;
				}, {})
			);
			setCriteria(payload?.data?.criteria || effectiveCriteria);
			setContinuation("");
			if (nextSuggestions.length === 0) {
				toast.info(m.PROMPT_OTTER_NO_SUGGESTIONS);
			}
			posthog?.capture(CLIENT_EVENTS.PROMPT_IMPROVEMENT_RUN_SUCCESS, {
				promptId: promptId || undefined,
				criteriaCount: effectiveCriteria.length,
				suggestionCount: nextSuggestions.length,
			});
		} catch (error: any) {
			posthog?.capture(CLIENT_EVENTS.PROMPT_IMPROVEMENT_RUN_FAILURE, {
				promptId: promptId || undefined,
				criteriaCount: effectiveCriteria.length,
				error: error?.message || m.PROMPT_OTTER_ANALYSIS_FAILED,
			});
			toast.error(error?.message || m.PROMPT_OTTER_ANALYSIS_FAILED);
		} finally {
			setIsRunning(false);
		}
	}, [continuation, criteria, m, posthog, prompt, promptId]);

	const acceptSuggestion = useCallback(
		(suggestion: LocalChange) => {
			if (suggestion.state !== "pending") return;
			if (!prompt.includes(suggestion.original)) {
				toast.error(m.PROMPT_OTTER_ORIGINAL_NOT_FOUND);
				return;
			}
			onApplyPrompt(replaceFirst(prompt, suggestion.original, suggestion.replacement));
			setSuggestions((prev) =>
				prev.map((item) =>
					item.id === suggestion.id
						? { ...item, state: "accepted", appliedAt: new Date().toISOString() }
						: item
				)
			);
			setExpandedSuggestions((prev) => ({ ...prev, [suggestion.id]: false }));
			posthog?.capture(CLIENT_EVENTS.PROMPT_IMPROVEMENT_SUGGESTION_ACCEPTED, {
				promptId: promptId || undefined,
				dimension: suggestion.dimension,
			});
		},
		[onApplyPrompt, posthog, prompt, promptId]
	);

	const declineSuggestion = useCallback((suggestion: LocalChange) => {
		setSuggestions((prev) =>
			prev.map((item) =>
				item.id === suggestion.id
					? { ...item, state: "declined", appliedAt: new Date().toISOString() }
					: item
			)
		);
		setExpandedSuggestions((prev) => ({ ...prev, [suggestion.id]: false }));
		posthog?.capture(CLIENT_EVENTS.PROMPT_IMPROVEMENT_SUGGESTION_DECLINED, {
			promptId: promptId || undefined,
			dimension: suggestion.dimension,
		});
	}, [posthog, promptId]);

	return (
		<div className="min-w-0 shrink-0 rounded-md border border-stone-200 bg-stone-50/80 dark:border-stone-800 dark:bg-stone-900/40">
			<div className="flex items-center justify-between gap-3 px-3 py-2">
				<button
					type="button"
					onClick={() => setIsOpen((value) => !value)}
					className="flex min-w-0 items-center gap-2 text-left text-sm font-medium text-stone-800 hover:text-primary dark:text-stone-100 dark:hover:text-primary"
				>
					<SparklesIcon className="h-4 w-4 shrink-0 text-primary" />
					<span className="truncate">{m.PROMPT_OTTER_TITLE}</span>
					{pendingCount > 0 && (
						<Badge variant="secondary" className="h-5 px-1.5 text-[11px]">
							{pendingCount} {m.PROMPT_OTTER_PENDING}
						</Badge>
					)}
				</button>
				<Button
					type="button"
					size="sm"
					variant="outline"
					onClick={runAnalysis}
					disabled={isRunning || criteria.length === 0}
					className="h-7 shrink-0 px-2 text-xs"
				>
					{isRunning ? (
						<Loader2Icon className="mr-1.5 h-3.5 w-3.5 animate-spin" />
					) : (
						<SparklesIcon className="mr-1.5 h-3.5 w-3.5" />
					)}
					{isRunning ? m.PROMPT_OTTER_ANALYZING : m.PROMPT_OTTER_RUN_SHORT}
				</Button>
			</div>

			{isOpen && (
				<div className="max-h-[260px] overflow-y-auto border-t border-stone-200 px-3 py-3 dark:border-stone-800">
					<div className="flex min-w-0 flex-wrap gap-1.5">
						{criteria.map((criterion, index) => (
							<span
								key={`${criterion}-${index}`}
								className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border border-stone-200 bg-white px-2 py-1 text-xs text-stone-600 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300"
							>
								<span className="min-w-0 truncate">{criterion}</span>
								<button
									type="button"
									onClick={() =>
										setCriteria((prev) =>
											prev.filter((_, itemIndex) => itemIndex !== index)
										)
									}
									className="text-stone-400 hover:text-red-500"
								>
									<XIcon className="h-3 w-3" />
								</button>
							</span>
						))}
					</div>

					<div className="mt-2 flex gap-2">
						<Input
							value={continuation}
							onChange={(event) => setContinuation(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter") {
									event.preventDefault();
									addCriterion();
								}
							}}
							placeholder={m.PROMPT_OTTER_CONTINUATION_PLACEHOLDER}
							className="h-8 border-stone-200 bg-white text-xs dark:border-stone-800 dark:bg-stone-950"
						/>
						<Button
							type="button"
							size="icon"
							variant="outline"
							onClick={addCriterion}
							className="h-8 w-8 shrink-0"
						>
							<PlusIcon className="h-3.5 w-3.5" />
						</Button>
					</div>

					{suggestions.length > 0 && (
						<div className="mt-3 min-w-0 space-y-0 border-l border-stone-200 pl-3 dark:border-stone-800">
							{suggestions.map((suggestion, index) => (
								(() => {
									const isExpanded =
										expandedSuggestions[suggestion.id] ?? suggestion.state === "pending";
									const isCollapsed = !isExpanded && suggestion.state !== "pending";
									return (
								<div
									key={suggestion.id}
									className="group relative min-w-0 pb-4 last:pb-0"
								>
									<div className="absolute -left-[17px] top-1 h-2 w-2 rounded-full bg-primary" />
									<div className="flex items-start justify-between gap-3">
										<div className="min-w-0">
											<div className="flex flex-wrap items-center gap-2 text-xs">
												<span className="font-medium text-stone-900 dark:text-stone-100">
													{index + 1}. {suggestion.dimension}
												</span>
												<span className="text-stone-400">/</span>
												<span
													className={
														suggestion.state === "accepted"
															? "text-green-600 dark:text-green-400"
															: suggestion.state === "declined"
																? "text-red-600 dark:text-red-400"
																: "text-stone-500 dark:text-stone-400"
													}
												>
													{suggestion.state}
												</span>
											</div>
											{isCollapsed ? (
												<button
													type="button"
													onClick={() =>
														setExpandedSuggestions((prev) => ({
															...prev,
															[suggestion.id]: true,
														}))
													}
													className="mt-1 inline-flex items-center gap-1 text-xs text-stone-500 hover:text-primary dark:text-stone-400 dark:hover:text-primary"
												>
													<ChevronRightIcon className="h-3 w-3" />
													{m.PROMPT_OTTER_SHOW_CHANGE}
												</button>
											) : (
												<p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
													{suggestion.rationale}
												</p>
											)}
										</div>
										<div className="flex shrink-0 gap-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
											{suggestion.state !== "pending" && isExpanded && (
												<Button
													type="button"
													size="icon"
													variant="ghost"
													onClick={() =>
														setExpandedSuggestions((prev) => ({
															...prev,
															[suggestion.id]: false,
														}))
													}
													className="h-7 w-7 text-stone-500 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-900"
												>
													<ChevronDownIcon className="h-3.5 w-3.5" />
												</Button>
											)}
											{suggestion.state === "pending" && (
												<>
												<Button
													type="button"
													size="icon"
													variant="ghost"
													onClick={() => acceptSuggestion(suggestion)}
													className="h-7 w-7 text-green-600 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-950"
												>
													<CheckIcon className="h-3.5 w-3.5" />
												</Button>
												<Button
													type="button"
													size="icon"
													variant="ghost"
													onClick={() => declineSuggestion(suggestion)}
													className="h-7 w-7 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
												>
													<XIcon className="h-3.5 w-3.5" />
												</Button>
												</>
											)}
										</div>
									</div>
									{isExpanded && (
									<div className="mt-2 grid min-w-0 gap-1 text-xs">
										<div className="max-h-24 overflow-auto whitespace-pre-wrap break-words font-mono text-red-700 line-through dark:text-red-300">
											- {suggestion.original}
										</div>
										<div className="max-h-24 overflow-auto whitespace-pre-wrap break-words font-mono text-green-700 dark:text-green-300">
											+ {suggestion.replacement}
										</div>
									</div>
									)}
								</div>
									);
								})()
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
}
