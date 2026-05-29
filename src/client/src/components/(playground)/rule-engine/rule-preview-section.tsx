"use client";
import { useState } from "react";
import { InfoIcon, PlayIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import getMessage from "@/constants/messages";

type PreviewResult = {
	TraceId: string;
	SpanId: string;
	ServiceName: string;
	SpanName: string;
	matched: boolean;
};

export default function RulePreviewSection({ ruleId }: { ruleId: string }) {
	const messages = getMessage();
	const [isRunning, setIsRunning] = useState(false);
	const [results, setResults] = useState<PreviewResult[] | null>(null);
	const [error, setError] = useState<string | null>(null);

	const runPreview = async () => {
		setIsRunning(true);
		setError(null);
		try {
			const res = await fetch(`/api/rule-engine/rules/${ruleId}/preview`, {
				method: "POST",
			});
			const json = await res.json();
			if (!res.ok || json.error) {
				setError(json.error || messages.RULE_PREVIEW_FAILED);
				setResults(null);
			} else {
				setResults(json.results || []);
			}
		} catch (e: any) {
			setError(e.message || messages.RULE_PREVIEW_FAILED);
		} finally {
			setIsRunning(false);
		}
	};

	return (
		<Card className="flex flex-col border border-stone-200 dark:border-stone-800 basis-1/2 overflow-hidden">
			<CardHeader className="p-4 pb-3 border-b border-stone-100 dark:border-stone-800">
				<div className="flex items-center justify-between gap-2">
					<div className="flex items-center gap-1.5">
						<CardTitle className="text-base text-stone-800 dark:text-stone-200">
							{messages.RULE_PREVIEW_TITLE}
						</CardTitle>
						<Tooltip>
							<TooltipTrigger asChild>
								<InfoIcon className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500 cursor-help" />
							</TooltipTrigger>
							<TooltipContent side="top" className="max-w-[220px] text-xs">
								{messages.RULE_PREVIEW_TOOLTIP}
							</TooltipContent>
						</Tooltip>
					</div>
					<Button
						size="sm"
						variant="outline"
						onClick={runPreview}
						disabled={isRunning}
						className={`h-8 text-stone-600 dark:text-stone-400 border-stone-300 dark:border-stone-600 ${isRunning ? "animate-pulse" : ""}`}
					>
						<PlayIcon className="w-3.5 h-3.5 mr-1.5" />
						{isRunning ? messages.RULE_PREVIEW_RUNNING : messages.RULE_PREVIEW_RUN}
					</Button>
				</div>
			</CardHeader>

			<CardContent className="p-4 flex flex-col gap-2 grow-1 overflow-y-auto">
				{isRunning &&
					[...Array(5)].map((_, i) => (
						<Skeleton key={i} className="h-[52px] w-full rounded-md" />
					))}

				{!isRunning && error && (
					<p className="text-xs text-red-500 dark:text-red-400 py-2">{error}</p>
				)}

				{!isRunning && results === null && (
					<p className="text-xs text-stone-400 dark:text-stone-500 text-center py-4">
						{messages.RULE_PREVIEW_EMPTY}
					</p>
				)}

				{!isRunning && results !== null && results.length === 0 && (
					<p className="text-xs text-stone-400 dark:text-stone-500 text-center py-4">
						{messages.RULE_PREVIEW_NO_MATCHES}
					</p>
				)}

				{!isRunning && results !== null && results.length > 0 && (
					<>
						{results.map((r, i) => (
							<div
								key={r.TraceId + r.SpanId + i}
								className={`flex items-center justify-between rounded-md border px-3 py-2.5 ${
									r.matched
										? "border-green-200 dark:border-green-800/60 bg-green-50 dark:bg-green-900/20"
										: "border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-900/50"
								}`}
							>
								<div className="flex flex-col gap-0.5 min-w-0">
									<span className="text-xs font-medium text-stone-700 dark:text-stone-300 truncate">
										{r.ServiceName || "—"} · {r.SpanName || "—"}
									</span>
									<span className="font-mono text-[10px] text-stone-400 dark:text-stone-500 truncate">
										{r.TraceId}
									</span>
								</div>
								<Badge
									variant={r.matched ? "default" : "secondary"}
									className={`ml-3 flex-shrink-0 text-[10px] ${
										r.matched
											? "bg-green-500 hover:bg-green-500 text-white"
											: ""
									}`}
								>
									{r.matched ? "Matched" : "No Match"}
								</Badge>
							</div>
						))}
					</>
				)}
			</CardContent>
		</Card>
	);
}
