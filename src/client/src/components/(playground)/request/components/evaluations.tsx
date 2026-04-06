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
import { useEffect, useState } from "react";
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

function EvaluationCard({ evaluation }: { evaluation: Evaluation }) {
	const [isExpanded, setIsExpanded] = useState(false);

	return (
		<div className="rounded-lg border border-stone-200 dark:border-stone-700 overflow-hidden">
			<button
				type="button"
				className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left bg-stone-50 dark:bg-stone-800/80 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-pointer"
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
				<div className="px-3 py-2.5 space-y-2 text-xs bg-white dark:bg-stone-900/50 border-t border-stone-200 dark:border-stone-700">
					<div>
						<span className="font-medium text-stone-500 dark:text-stone-400">Classification: </span>
						<span className="text-stone-700 dark:text-stone-300">{evaluation.classification}</span>
					</div>
					<div>
						<span className="font-medium text-stone-500 dark:text-stone-400">Explanation: </span>
						<span className="text-stone-700 dark:text-stone-300">{evaluation.explanation}</span>
					</div>
					<div>
						<span className="font-medium text-stone-500 dark:text-stone-400">Verdict: </span>
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
				toast.error("Failed to save feedback");
			},
		});
	};

	return (
		<div className="rounded-lg border border-stone-200 dark:border-stone-700 overflow-hidden">
			<div className="px-3 py-2.5 border-b border-stone-200 dark:border-stone-700">
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
					Rule Engine & Run Details
				</span>
			</div>
			<div className="px-3 py-2.5 text-xs space-y-2 text-stone-600 dark:text-stone-400">
				{source && (
					<p>
						<span className="font-medium">Source:</span>{" "}
						{source === "manual" ? "Manual" : "Auto"}
					</p>
				)}
				{model && (
					<p>
						<span className="font-medium">Engine:</span> {model}
					</p>
				)}
				{matchingRuleIds.length > 0 && (
					<div className="flex flex-wrap items-center gap-1">
						<span className="font-medium shrink-0">Rules applied:</span>
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
						<span className="font-medium shrink-0">Context:</span>
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
						<span className="font-medium">Context:</span> Applied from context
						entities
					</p>
				)}
			</div>
		</div>
	);
}

function EvaluationRunCard({
	run,
	ruleContext,
}: {
	run: EvaluationRun;
	ruleContext?: { matchingRuleIds: string[]; contextApplied: boolean };
}) {
	const source = run.meta?.source;
	const model = run.meta?.model;
	const cost = run.cost ?? (run.meta?.cost ? parseFloat(run.meta.cost) : undefined);
	const evals = run.evaluations?.filter((e) => e.evaluation !== "manual_feedback") ?? [];
	const runDate = run.createdAt ? new Date(run.createdAt) : null;
	const dateStr = runDate ? format(runDate, "MMM d, yyyy HH:mm:ss") : "—";

	return (
		<div className="rounded-lg border border-stone-200 dark:border-stone-700 overflow-hidden">
			<div className="flex items-center justify-between gap-3 px-3 py-2.5 bg-stone-50 dark:bg-stone-800/80 border-b border-stone-200 dark:border-stone-700">
				<div className="flex items-center gap-2 min-w-0">
					<Badge
						variant="outline"
						className="text-[10px] font-medium shrink-0 border-stone-300 dark:border-stone-600"
					>
						{source === "manual" ? "Manual" : "Auto"}
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
			<div className="p-3 space-y-2">
				{evals.length === 0 ? (
					<p className="text-xs text-stone-500 dark:text-stone-400">No evaluations</p>
				) : (
					evals.map((evaluation, index) => (
						<EvaluationCard key={index} evaluation={evaluation} />
					))
				)}
			</div>
		</div>
	);
}

export default function Evaluations({ trace }: { trace: TransformedTraceRow }) {
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

	if (isLoading || !isFetched || isRunEvaluationLoading) {
		return (
			<div className="flex flex-col gap-3 px-4 py-2">
				<div className="text-sm text-stone-500 dark:text-stone-300">
					{getMessage().EVALUATION_DATA_LOADING}
				</div>
			</div>
		);
	}

	if (responseData?.configErr) {
		return (
			<div className="flex flex-col gap-3 px-4 py-2">
				<div className="text-sm text-stone-500 dark:text-stone-300">
					{getMessage().EVALUATION_CONFIG_NOT_SET}
				</div>
				<Button variant="destructive" className="w-fit">
					<Link href="/evaluations/settings">
						{getMessage().EVALUATION_CONFIG_SET}
					</Link>
				</Button>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-3 px-3 py-2">
			{/* Actions bar */}
			<div className="flex flex-wrap items-center gap-2 pb-2 border-b border-stone-200 dark:border-stone-700">
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
						{runs.length} run{runs.length !== 1 ? "s" : ""}
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
						Runs
					</h4>
					<div className="space-y-2">
						{runs.map((run) => (
							<EvaluationRunCard
								key={run.id}
								run={run}
								ruleContext={ruleContext}
							/>
						))}
					</div>
				</div>
			) : hasLegacyEvals && legacyEvals ? (
				<div className="space-y-3">
					<h4 className="text-xs font-medium text-stone-500 dark:text-stone-400 uppercase tracking-wide">
						Evaluations
					</h4>
					<div className="space-y-2">
						{legacyEvals.map((evaluation, index) => (
							<EvaluationCard key={index} evaluation={evaluation} />
						))}
					</div>
				</div>
			) : !hasRuns && hasConfig ? (
				<p className="text-sm text-stone-500 dark:text-stone-400 py-2">
					{getMessage().EVALUATION_NOT_RUN_YET}
				</p>
			) : null}

			{/* Manual feedback */}
			<div className="space-y-3 pt-3 border-t border-stone-200 dark:border-stone-700">
				<FeedbackList feedbacks={feedbacks} />
				<ManualFeedbackForm spanId={trace.spanId} onSuccess={getEvaluations} />
			</div>
		</div>
	);
}
