import { Button } from "@/components/ui/button";
import getMessage from "@/constants/messages";
import {
	Evaluation,
	EvaluationConfigResponse,
	EvaluationRun,
	ManualFeedback,
} from "@/types/evaluation";
import { TransformedTraceRow } from "@/types/trace";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
	ChevronDown,
	ChevronUp,
	Zap,
	ExternalLink,
	ThumbsUp,
	ThumbsDown,
	Minus,
	Play,
	MessageSquare,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";

function formatEvalTypeLabel(type: string): string {
	if (type === "manual_feedback") return getMessage().EVALUATION_MANUAL_FEEDBACK;
	return type
		.split("_")
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
		.join(" ");
}

function getScoreColor(score: number): string {
	if (score < 0.3)
		return "bg-green-100 dark:bg-green-900 text-green-900 dark:text-green-50";
	if (score < 0.7)
		return "bg-yellow-100 dark:bg-yellow-900 text-yellow-900 dark:text-yellow-50";
	return "bg-red-100 dark:bg-red-900 text-red-900 dark:text-red-50";
}

function EvaluationCard({
	evaluation,
	surface = "default",
}: {
	evaluation: Evaluation;
	surface?: "default" | "observability";
}) {
	const m = getMessage();
	const isObservabilitySurface = surface === "observability";
	const [isExpanded, setIsExpanded] = useState(false);

	return (
		<div
			className={`overflow-hidden rounded-md border ${
				isObservabilitySurface
					? "border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950"
					: "border-stone-200 dark:border-stone-700"
			}`}
		>
			<button
				type="button"
				className={`w-full flex items-center justify-between gap-3 px-3 text-left transition-colors cursor-pointer ${
					isObservabilitySurface
						? "py-2 bg-white hover:bg-stone-50 dark:bg-stone-950 dark:hover:bg-stone-900"
						: "py-2.5 bg-stone-50 dark:bg-stone-800/80 hover:bg-stone-100 dark:hover:bg-stone-800"
				}`}
				onClick={() => setIsExpanded(!isExpanded)}
			>
				<span className="text-sm font-medium text-stone-700 dark:text-stone-300">
					{formatEvalTypeLabel(evaluation.evaluation)}
				</span>
				<div className="flex items-center gap-2 shrink-0">
					<Badge
						variant="outline"
						className={`${getScoreColor(evaluation.score)} border-none text-xs font-medium`}
					>
						{evaluation.score}
					</Badge>
					{isExpanded ? (
						<ChevronUp className="size-4 text-stone-400" />
					) : (
						<ChevronDown className="size-4 text-stone-400" />
					)}
				</div>
			</button>
			{isExpanded && (
				<div className="px-3 py-2.5 space-y-2 text-xs bg-stone-50/70 dark:bg-stone-900/40 border-t border-stone-200 dark:border-stone-800">
					<div>
						<span className="font-medium text-stone-500 dark:text-stone-400">
							{m.EVALUATION_CLASSIFICATION}:{" "}
						</span>
						<span className="text-stone-700 dark:text-stone-300">{evaluation.classification}</span>
					</div>
					<div>
						<span className="font-medium text-stone-500 dark:text-stone-400">
							{m.EVALUATION_EXPLANATION}:{" "}
						</span>
						<span className="text-stone-700 dark:text-stone-300">{evaluation.explanation}</span>
					</div>
					<div>
						<span className="font-medium text-stone-500 dark:text-stone-400">
							{m.EVALUATION_VERDICT}:{" "}
						</span>
						<span className="text-stone-700 dark:text-stone-300">{evaluation.verdict}</span>
					</div>
				</div>
			)}
		</div>
	);
}

function ManualFeedbackForm({
	spanId,
	onSuccess,
}: {
	spanId: string;
	onSuccess: () => void;
}) {
	const [rating, setRating] = useState<
		"positive" | "negative" | "neutral" | null
	>(null);
	const [comment, setComment] = useState("");
	const { fireRequest, isLoading } = useFetchWrapper();

	const handleSubmit = () => {
		if (!rating) return;
		fireRequest({
			url: `/api/evaluation/${spanId}/feedback`,
			requestType: "POST",
			body: JSON.stringify({ rating, comment: comment.trim() || undefined }),
			successCb: () => {
				toast.success(getMessage().EVALUATION_FEEDBACK_SAVED);
				setRating(null);
				setComment("");
				onSuccess();
			},
			failureCb: () => {
				toast.error(getMessage().EVALUATION_FEEDBACK_SAVE_FAILURE);
			},
		});
	};

	return (
		<div className="rounded-lg border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950 overflow-hidden">
			<div className="px-3 py-2.5 border-b border-stone-200 dark:border-stone-800">
				<h4 className="text-xs font-medium text-stone-500 dark:text-stone-400">
					{getMessage().EVALUATION_MANUAL_FEEDBACK}
				</h4>
				<p className="text-[10px] text-stone-500 dark:text-stone-400 mt-0.5">
					{getMessage().EVALUATION_MANUAL_FEEDBACK_DESCRIPTION}
				</p>
			</div>
			<div className="px-3 py-3 space-y-3">
				<div className="flex items-center gap-2">
					<Button
						variant={rating === "positive" ? "default" : "outline"}
						size="sm"
						className="h-8"
						onClick={() => setRating("positive")}
					>
						<ThumbsUp className="size-3.5 mr-1" />
						{getMessage().EVALUATION_FEEDBACK_POSITIVE}
					</Button>
					<Button
						variant={rating === "negative" ? "default" : "outline"}
						size="sm"
						className="h-8"
						onClick={() => setRating("negative")}
					>
						<ThumbsDown className="size-3.5 mr-1" />
						{getMessage().EVALUATION_FEEDBACK_NEGATIVE}
					</Button>
					<Button
						variant={rating === "neutral" ? "default" : "outline"}
						size="sm"
						className="h-8"
						onClick={() => setRating("neutral")}
					>
						<Minus className="size-3.5 mr-1" />
						{getMessage().EVALUATION_FEEDBACK_NEUTRAL}
					</Button>
				</div>
				<Input
					placeholder={getMessage().EVALUATION_FEEDBACK_COMMENT_PLACEHOLDER}
					value={comment}
					onChange={(e) => setComment(e.target.value)}
					className="text-sm h-8"
				/>
				<Button
					size="sm"
					onClick={handleSubmit}
					disabled={!rating || isLoading}
				>
					{getMessage().EVALUATION_FEEDBACK_SUBMIT}
				</Button>
			</div>
		</div>
	);
}

function FeedbackList({ feedbacks }: { feedbacks: ManualFeedback[] }) {
	if (!feedbacks?.length) return null;
	return (
		<div className="space-y-2">
			<h4 className="text-xs font-medium text-stone-500 dark:text-stone-400 flex items-center gap-1.5">
				<MessageSquare className="size-3.5" />
				{getMessage().EVALUATION_MANUAL_FEEDBACK}
			</h4>
			<div className="space-y-2">
				{feedbacks.map((fb, i) => (
					<div
						key={i}
						className="flex items-start gap-2 px-2.5 py-2 rounded-md bg-stone-50 dark:bg-stone-800/50 text-xs"
					>
						{fb.rating === "positive" ? (
							<ThumbsUp className="size-3.5 text-green-600 shrink-0 mt-0.5" />
						) : fb.rating === "negative" ? (
							<ThumbsDown className="size-3.5 text-red-600 shrink-0 mt-0.5" />
						) : (
							<Minus className="size-3.5 text-stone-500 shrink-0 mt-0.5" />
						)}
						<div className="min-w-0">
							<span className="font-medium capitalize text-stone-700 dark:text-stone-300">{fb.rating}</span>
							{fb.comment && (
								<span className="block text-stone-500 dark:text-stone-400 mt-0.5">
									{fb.comment}
								</span>
							)}
							<span className="block text-stone-400 dark:text-stone-500 text-[10px] mt-0.5">
								{fb.createdAt ? format(new Date(fb.createdAt), "MMM d, yyyy HH:mm") : "—"}
							</span>
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

function RuleEngineInfo({
	meta,
	ruleContext,
}: {
	meta?: Record<string, any>;
	ruleContext?: {
		matchingRuleIds: string[];
		contextApplied: boolean;
		contextEntityIds?: string[];
	};
}) {
	const model = meta?.model;
	const ruleIds = meta?.ruleIds
		? String(meta.ruleIds).split(",").filter(Boolean)
		: [];
	const contextIds = meta?.contextIds
		? String(meta.contextIds).split(",").filter(Boolean)
		: [];
	const contextApplied = meta?.contextApplied === "yes" || ruleContext?.contextApplied;
	const matchingRuleIds = ruleContext?.matchingRuleIds || ruleIds;
	const contextEntityIds = ruleContext?.contextEntityIds || contextIds;
	const source = meta?.source; // 'manual' | 'auto'

	if (!model && !matchingRuleIds.length && !source && !contextEntityIds.length)
		return null;

	return (
		<div className="rounded-lg border border-stone-200 dark:border-stone-700 overflow-hidden">
			<div className="px-3 py-2.5 border-b border-stone-200 dark:border-stone-700 flex items-center gap-1.5">
				<Zap className="size-3.5 text-stone-500" />
				<span className="text-xs font-medium text-stone-500 dark:text-stone-400">
					{getMessage().EVALUATION_RULE_ENGINE_DETAILS}
				</span>
			</div>
			<div className="px-3 py-2.5 text-xs space-y-2 text-stone-600 dark:text-stone-400">
				{source && (
					<p>
						<span className="font-medium">
							{getMessage().EVALUATION_SOURCE}:
						</span>{" "}
						{source === "manual"
							? getMessage().EVALUATION_SOURCE_MANUAL
							: getMessage().EVALUATION_SOURCE_AUTO}
					</p>
				)}
				{model && (
					<p>
						<span className="font-medium">
							{getMessage().EVALUATION_ENGINE}:
						</span>{" "}
						{model}
					</p>
				)}
				{matchingRuleIds.length > 0 && (
					<div className="flex flex-wrap items-center gap-1">
						<span className="font-medium shrink-0">
							{getMessage().EVALUATION_RULES_APPLIED}:
						</span>
						{matchingRuleIds.map((rid) => (
							<Link
								key={rid}
								href={`/rule-engine/${rid}`}
								className="text-primary hover:underline"
							>
								{rid.slice(0, 8)}…
							</Link>
						))}
					</div>
				)}
				{contextApplied && contextEntityIds.length > 0 && (
					<div className="flex flex-wrap items-center gap-1">
						<span className="font-medium shrink-0">
							{getMessage().EVALUATION_CONTEXT}:
						</span>
						{contextEntityIds.map((cid) => (
							<Link
								key={cid}
								href={`/context/${cid}`}
								className="text-primary hover:underline"
							>
								{cid.slice(0, 8)}…
							</Link>
						))}
					</div>
				)}
				{contextApplied && contextEntityIds.length === 0 && (
					<p>
						<span className="font-medium">
							{getMessage().EVALUATION_CONTEXT}:
						</span>{" "}
						{getMessage().EVALUATION_CONTEXT_APPLIED}
					</p>
				)}
			</div>
		</div>
	);
}

function EvaluationRunCard({
	run,
	ruleContext,
	surface = "default",
}: {
	run: EvaluationRun;
	ruleContext?: { matchingRuleIds: string[]; contextApplied: boolean };
	surface?: "default" | "observability";
}) {
	const isObservabilitySurface = surface === "observability";
	const source = run.meta?.source;
	const model = run.meta?.model;
	const cost = run.cost ?? (run.meta?.cost ? parseFloat(run.meta.cost) : undefined);
	const evals = run.evaluations?.filter((e) => e.evaluation !== "manual_feedback") ?? [];
	const runDate = run.createdAt ? new Date(run.createdAt) : null;
	const dateStr = runDate ? format(runDate, "MMM d, yyyy HH:mm:ss") : "—";

	return (
		<div
			className={`overflow-hidden rounded-md border ${
				isObservabilitySurface
					? "border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950"
					: "border-stone-200 dark:border-stone-700"
			}`}
		>
			<div
				className={`flex items-center justify-between gap-3 border-b px-3 ${
					isObservabilitySurface
						? "py-2 border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950"
						: "py-2.5 bg-stone-50 dark:bg-stone-800/80 border-stone-200 dark:border-stone-700"
				}`}
			>
				<div className="flex items-center gap-2 min-w-0">
					<Badge
						variant="outline"
						className="text-[10px] font-medium shrink-0 border-stone-300 dark:border-stone-600"
					>
						{source === "manual"
							? getMessage().EVALUATION_SOURCE_MANUAL
							: getMessage().EVALUATION_SOURCE_AUTO}
					</Badge>
					<span className="text-xs text-stone-600 dark:text-stone-400 truncate">
						{dateStr}
					</span>
					{model && (
						<span className="text-[10px] text-stone-400 dark:text-stone-500 truncate max-w-[120px]">
							{model}
						</span>
					)}
				</div>
				{cost != null && cost > 0 && (
					<span className="text-xs font-medium text-stone-600 dark:text-stone-300 shrink-0">
						${cost.toFixed(6)}
					</span>
				)}
			</div>
			<div className={isObservabilitySurface ? "space-y-2 bg-stone-50/60 p-2.5 dark:bg-stone-950" : "p-3 space-y-2"}>
				{evals.length === 0 ? (
					<p className="text-xs text-stone-500 dark:text-stone-400">
						{getMessage().EVALUATION_NO_RESULTS}
					</p>
				) : (
					evals.map((evaluation, index) => (
						<EvaluationCard
							key={index}
							evaluation={evaluation}
							surface={surface}
						/>
					))
				)}
			</div>
		</div>
	);
}

export default function Evaluations({
	trace,
	surface = "default",
}: {
	trace: TransformedTraceRow;
	surface?: "default" | "observability";
}) {
	const isObservabilitySurface = surface === "observability";
	const [error, setError] = useState<string | null>(null);
	const {
		data: responseData,
		error: responseErr,
		isLoading,
		fireRequest,
		isFetched,
	} = useFetchWrapper<EvaluationConfigResponse>();

	const evaluationData = responseData?.data;
	const runs = responseData?.runs || [];
	const ruleContext = responseData?.ruleContext;
	const feedbacks = responseData?.feedbacks || [];

	const {
		fireRequest: runEvaluationRequest,
		isLoading: isRunEvaluationLoading,
	} = useFetchWrapper();

	const runEvaluation = () => {
		runEvaluationRequest({
			url: `/api/evaluation/${trace.spanId}`,
			requestType: "POST",
			responseDataKey: "data",
			successCb: (data: { success: boolean; error?: string }) => {
				if (data?.success) {
					getEvaluations();
				} else {
					setError(data?.error || getMessage().EVALUATION_RUN_FAILURE);
				}
			},
			failureCb: () => {
				toast.error(getMessage().EVALUATION_RUN_FAILURE);
			},
		});
	};

	const getEvaluations = () => {
		fireRequest({
			url: `/api/evaluation/${trace.spanId}`,
			requestType: "GET",
		});
	};

	useEffect(() => {
		if (!evaluationData?.id && !responseData?.config) {
			getEvaluations();
		}
	}, [trace.spanId]);

	const hasConfig = !!responseData?.config;
	const hasError = !!(responseData?.err || error || responseErr);
	const hasRuns = runs.length > 0;
	const legacyEvals = evaluationData?.evaluations?.filter(
		(e) => e.evaluation !== "manual_feedback"
	);
	const hasLegacyEvals = !hasRuns && (legacyEvals?.length ?? 0) > 0;

	const renderShell = (
		children: ReactNode,
		options?: { status?: string; showRunAction?: boolean }
	) => {
		if (!isObservabilitySurface) return children;

		return (
			<section className="overflow-hidden rounded-md border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950">
				<div className="flex flex-wrap items-center gap-2 border-b border-stone-200 bg-stone-50 px-3 py-2 dark:border-stone-800 dark:bg-stone-900">
					<div className="mr-auto min-w-0">
						<h2 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
							{getMessage().OBSERVABILITY_EVALUATION_PANEL}
						</h2>
						<p className="text-xs text-stone-500 dark:text-stone-400">
							{options?.status || getMessage().EVALUATION_MANUAL_AND_AUTO}
						</p>
					</div>
					{options?.showRunAction && hasConfig && (
						<Button
							variant="default"
							size="sm"
							className="h-7 gap-1.5 bg-primary px-2.5 text-xs"
							onClick={runEvaluation}
							disabled={isRunEvaluationLoading}
						>
							<Play className="size-3.5" />
							{getMessage().EVALUATION_RUN}
						</Button>
					)}
				</div>
				<div className="bg-stone-50/60 p-3 dark:bg-stone-950">{children}</div>
			</section>
		);
	};

	if (isLoading || !isFetched || isRunEvaluationLoading) {
		return renderShell(
			<div className="flex flex-col gap-3 px-4 py-2">
				<div className="text-sm text-stone-500 dark:text-stone-300">
					{getMessage().EVALUATION_DATA_LOADING}
				</div>
			</div>,
			{ status: getMessage().EVALUATION_DATA_LOADING }
		);
	}

	if (responseData?.configErr) {
		return renderShell(
			<div className="flex flex-col gap-3 px-4 py-2">
				<div className="text-sm text-stone-500 dark:text-stone-300">
					{getMessage().EVALUATION_CONFIG_NOT_SET}
				</div>
				<Button variant="destructive" className="w-fit">
					<Link href="/evaluations/settings">
						{getMessage().EVALUATION_CONFIG_SET}
					</Link>
				</Button>
			</div>,
			{ status: getMessage().EVALUATION_CONFIG_NOT_SET }
		);
	}

	return renderShell(
		<div className={isObservabilitySurface ? "flex flex-col gap-3" : "flex flex-col gap-3 px-3 py-2"}>
			{/* Actions bar */}
			<div className={`${isObservabilitySurface ? "hidden" : "flex"} flex-wrap items-center gap-2 pb-2 border-b border-stone-200 dark:border-stone-700`}>
				{hasConfig && (
					<Button
						variant="default"
						size="sm"
						className="bg-primary gap-1.5"
						onClick={runEvaluation}
						disabled={isRunEvaluationLoading}
					>
						<Play className="size-3.5" />
						{getMessage().EVALUATION_RUN}
					</Button>
				)}
				{hasRuns && (
					<Link
						href="/evaluations/types"
						className="text-xs text-stone-500 dark:text-stone-400 hover:text-primary inline-flex items-center gap-1"
					>
						{getMessage().EVALUATION_RUN_COUNT(runs.length)}
						<ExternalLink className="size-3" />
					</Link>
				)}
			</div>

			{/* Error banner */}
			{hasError && (
				<div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/20 px-3 py-2">
					<span className="text-xs text-stone-800 dark:text-stone-200 break-all font-mono">
						{String(responseData?.err || error || responseErr || getMessage().EVALUATION_RUN_FAILURE)}
					</span>
				</div>
			)}

			{/* Rule engine info */}
			<RuleEngineInfo meta={evaluationData?.meta} ruleContext={ruleContext} />

			{/* Evaluation runs or legacy single run */}
			{hasRuns ? (
				<div className="space-y-3">
					<h4 className="text-xs font-medium text-stone-500 dark:text-stone-400 uppercase tracking-wide">
						{getMessage().EVALUATION_RUNS}
					</h4>
					<div className="space-y-2">
						{runs.map((run) => (
							<EvaluationRunCard
								key={run.id}
								run={run}
								ruleContext={ruleContext}
								surface={surface}
							/>
						))}
					</div>
				</div>
			) : hasLegacyEvals && legacyEvals ? (
				<div className="space-y-3">
					<h4 className="text-xs font-medium text-stone-500 dark:text-stone-400 uppercase tracking-wide">
						{getMessage().EVALUATION_RESULTS}
					</h4>
					<div className="space-y-2">
						{legacyEvals.map((evaluation, index) => (
							<EvaluationCard
								key={index}
								evaluation={evaluation}
								surface={surface}
							/>
						))}
					</div>
				</div>
			) : !hasRuns && hasConfig ? (
				<p className="text-sm text-stone-500 dark:text-stone-400 py-2">
					{getMessage().EVALUATION_NOT_RUN_YET}
				</p>
			) : null}

			{/* Manual feedback */}
			<div className="space-y-3 pt-3">
				<FeedbackList feedbacks={feedbacks} />
				<ManualFeedbackForm spanId={trace.spanId} onSuccess={getEvaluations} />
			</div>
		</div>,
		{
			showRunAction: true,
			status: hasRuns
				? getMessage().EVALUATION_RUN_COUNT(runs.length)
				: hasConfig
					? getMessage().EVALUATION_NOT_RUN_YET
					: getMessage().EVALUATION_MANUAL_AND_AUTO,
		}
	);
}
