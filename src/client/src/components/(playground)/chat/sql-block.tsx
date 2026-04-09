"use client";

import { useState, useCallback } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import {
	oneDark,
	oneLight,
} from "react-syntax-highlighter/dist/cjs/styles/prism";
import { Button } from "@/components/ui/button";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@/components/ui/accordion";
import { Copy, Play, Check, Loader2, Code } from "lucide-react";
import { useTheme } from "next-themes";
import getMessage from "@/constants/messages";
import ResultDisplay from "./result-display";

interface SqlBlockProps {
	code: string;
	messageId?: string;
	onExecute?: (
		query: string,
		messageId?: string
	) => Promise<{ data?: any[]; stats?: any; err?: string }>;
}

export default function SqlBlock({
	code,
	messageId,
	onExecute,
}: SqlBlockProps) {
	const [copied, setCopied] = useState(false);
	const [executing, setExecuting] = useState(false);
	const [result, setResult] = useState<any[] | null>(null);
	const [stats, setStats] = useState<any>(null);
	const [error, setError] = useState<string | null>(null);
	const { resolvedTheme } = useTheme();

	const handleCopy = useCallback(async () => {
		await navigator.clipboard.writeText(code);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	}, [code]);

	const handleExecute = useCallback(async () => {
		if (!onExecute) return;
		setExecuting(true);
		setError(null);
		setResult(null);

		try {
			const res = await onExecute(code, messageId);
			if (res.err) {
				setError(typeof res.err === "string" ? res.err : JSON.stringify(res.err));
			} else {
				setResult(res.data || []);
				setStats(res.stats || null);
			}
		} catch (e: any) {
			setError(e.message || getMessage().CHAT_QUERY_EXECUTION_FAILED);
		} finally {
			setExecuting(false);
		}
	}, [code, messageId, onExecute]);

	return (
		<div className="my-3 rounded-lg border border-stone-200 dark:border-stone-700 overflow-hidden bg-white dark:bg-stone-900">
			{/* SQL Query in Accordion — collapsed by default */}
			<Accordion type="single" collapsible>
				<AccordionItem value="sql" className="border-b-0">
					<div className="flex items-center justify-between px-3 py-1.5 bg-stone-50 dark:bg-stone-800/50">
						<AccordionTrigger className="py-1.5 hover:no-underline gap-2 text-xs font-medium text-stone-500 dark:text-stone-400">
							<div className="flex items-center gap-1.5">
								<Code className="h-3.5 w-3.5" />
								{getMessage().CHAT_SQL_LABEL}
							</div>
						</AccordionTrigger>
						<div className="flex items-center gap-1.5">
							<Button
								variant="ghost"
								size="sm"
								className="h-6 px-2 text-xs text-stone-500 dark:text-stone-400"
								onClick={handleCopy}
							>
								{copied ? (
									<Check className="h-3 w-3 mr-1" />
								) : (
									<Copy className="h-3 w-3 mr-1" />
								)}
								{copied ? getMessage().CHAT_COPIED : getMessage().CHAT_COPY}
							</Button>
							{onExecute && (
								<Button
									variant="default"
									size="sm"
									className="h-6 px-2 text-xs"
									onClick={handleExecute}
									disabled={executing}
								>
									{executing ? (
										<Loader2 className="h-3 w-3 mr-1 animate-spin" />
									) : (
										<Play className="h-3 w-3 mr-1" />
									)}
									{executing ? getMessage().CHAT_RUNNING : getMessage().CHAT_EXECUTE}
								</Button>
							)}
						</div>
					</div>
					<AccordionContent className="pb-0" parentClassName="border-t border-stone-200 dark:border-stone-700">
						<SyntaxHighlighter
							language="sql"
							style={resolvedTheme === "dark" ? oneDark : oneLight}
							customStyle={{
								margin: 0,
								borderRadius: 0,
								fontSize: "13px",
								padding: "12px 16px",
								background: "transparent",
							}}
						>
							{code}
						</SyntaxHighlighter>
					</AccordionContent>
				</AccordionItem>
			</Accordion>

			{/* Error */}
			{error && (
				<div className="px-4 py-3 bg-red-50 dark:bg-red-950/30 border-t border-red-200 dark:border-red-800">
					<p className="text-sm text-red-700 dark:text-red-300 font-mono">
						{error}
					</p>
				</div>
			)}

			{/* Loading state */}
			{executing && !result && (
				<div className="flex items-center justify-center gap-2 px-4 py-6 border-t border-stone-200 dark:border-stone-700">
					<Loader2 className="h-4 w-4 animate-spin text-stone-400" />
					<span className="text-sm text-stone-400 dark:text-stone-500">{getMessage().CHAT_RUNNING}</span>
				</div>
			)}

			{/* Results */}
			{result && (
				<div className="border-t border-stone-200 dark:border-stone-700">
					<ResultDisplay
						data={result}
						stats={stats}
						query={code}
					/>
				</div>
			)}
		</div>
	);
}
