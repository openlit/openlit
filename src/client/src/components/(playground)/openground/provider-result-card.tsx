"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ProviderResult } from "@/lib/platform/openground-clickhouse";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { useState } from "react";
import JSONViewer from "@/components/common/json-viewer";
import getMessage from "@/constants/messages";

interface ProviderResultCardProps {
	result: ProviderResult;
	index: number;
}

export default function ProviderResultCard({ result }: ProviderResultCardProps) {
	const m = getMessage();
	const [showJson, setShowJson] = useState(false);

	return (
		<Card
			className={`overflow-hidden border ${
				result.error
					? "border-rose-200 dark:border-rose-900/70"
					: "border-stone-200 dark:border-stone-800"
			}`}
		>
			{/* Header */}
			<div className="border-b border-stone-200 bg-stone-50 px-4 py-3 dark:border-stone-800 dark:bg-stone-900">
				<div className="flex items-center justify-between gap-3">
					<div className="flex min-w-0 items-center gap-3">
						<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-stone-200 text-sm font-semibold text-stone-600 dark:bg-stone-800 dark:text-stone-300">
							{result.provider.charAt(0).toUpperCase()}
						</div>
						<div className="min-w-0">
							<p className="truncate text-sm font-medium text-stone-900 dark:text-stone-100">
								{result.provider}/{result.model}
							</p>
							<p className="text-xs text-stone-500 dark:text-stone-400">
								{result.responseTime.toFixed(2)}s •{" "}
								{result.totalTokens.toLocaleString()} {m.OPENGROUND_LIST_TOKENS_SUFFIX} •{" "}
								${result.cost.toFixed(6)}
							</p>
						</div>
					</div>
					{result.error ? (
						<Badge
							variant="outline"
							className="shrink-0 border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/40 dark:text-rose-300"
						>
							{m.ERROR}
						</Badge>
					) : (
						<Badge
							variant="outline"
							className="shrink-0 border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-300"
						>
							{m.SUCCESS}
						</Badge>
					)}
				</div>
			</div>

			{/* Response/Error Content */}
			<div className="p-4">
				{result.error ? (
					<div className="whitespace-pre-wrap break-all font-mono text-sm text-rose-600 dark:text-rose-400">
						{result.error}
					</div>
				) : (
					<p className="whitespace-pre-wrap text-sm text-stone-700 dark:text-stone-300">
						{result.response}
					</p>
				)}
			</div>

			{/* Collapsible JSON Section */}
			<div className="border-t border-stone-200 dark:border-stone-800">
				<Button
					variant="ghost"
					onClick={() => setShowJson(!showJson)}
					className="h-9 w-full justify-between rounded-none hover:bg-stone-50 dark:hover:bg-stone-900"
					aria-expanded={showJson}
				>
					<span className="text-xs font-medium text-stone-600 dark:text-stone-400">
						{showJson ? m.HIDE : m.SHOW} {m.OPENGROUND_RAW_RESPONSE_DATA}
					</span>
					{showJson ? (
						<ChevronUpIcon className="h-4 w-4" />
					) : (
						<ChevronDownIcon className="h-4 w-4" />
					)}
				</Button>

				{showJson && (
					<div className="overflow-auto border-t border-stone-200 bg-stone-50 p-4 text-xs dark:border-stone-800 dark:bg-stone-900">
						<JSONViewer value={result} />
					</div>
				)}
			</div>
		</Card>
	);
}
