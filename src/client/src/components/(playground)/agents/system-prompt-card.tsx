"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import getMessage from "@/constants/messages";
import { extractSystemInstructionsText } from "@/helpers/client/span-messages";

interface SystemPromptCardProps {
	prompt: string;
}

export default function SystemPromptCard({ prompt }: SystemPromptCardProps) {
	const [copied, setCopied] = useState(false);
	const [showRaw, setShowRaw] = useState(false);
	const { text, isStructured } = useMemo(
		() => extractSystemInstructionsText(prompt),
		[prompt]
	);
	// Guard the "Copied!" reset timer so unmount or rapid re-clicks don't
	// leave a setTimeout running that would call setState on a stale tree.
	const copyResetTimerRef = useRef<number | null>(null);
	useEffect(() => {
		return () => {
			if (copyResetTimerRef.current !== null) {
				window.clearTimeout(copyResetTimerRef.current);
				copyResetTimerRef.current = null;
			}
		};
	}, []);
	const onCopy = async () => {
		try {
			await navigator.clipboard.writeText(text || prompt);
			setCopied(true);
			if (copyResetTimerRef.current !== null) {
				window.clearTimeout(copyResetTimerRef.current);
			}
			copyResetTimerRef.current = window.setTimeout(() => {
				setCopied(false);
				copyResetTimerRef.current = null;
			}, 1500);
		} catch {
			/* user can copy manually */
		}
	};
	return (
		<div className="border dark:border-stone-800 rounded-lg">
			<div className="flex items-center justify-between px-4 py-3 border-b dark:border-stone-800">
				<h3 className="text-sm font-medium text-stone-900 dark:text-stone-100">
					{getMessage().AGENTS_DEFINITION_SYSTEM_PROMPT}
				</h3>
				<div className="flex items-center gap-2">
					{isStructured && (
						<button
							onClick={() => setShowRaw((v) => !v)}
							className="text-xs text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 underline-offset-2 hover:underline"
						>
							{showRaw
								? getMessage().AGENTS_DEFINITION_VIEW_FORMATTED
								: getMessage().AGENTS_DEFINITION_VIEW_RAW}
						</button>
					)}
					{prompt && (
						<button
							onClick={onCopy}
							className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-800"
						>
							{copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
							{copied
								? getMessage().AGENTS_DEFINITION_COPIED
								: getMessage().AGENTS_DEFINITION_COPY}
						</button>
					)}
				</div>
			</div>
			<div className="p-4">
				{prompt ? (
					showRaw ? (
						<pre className="whitespace-pre-wrap font-mono text-xs text-stone-700 dark:text-stone-300 max-h-[640px] overflow-y-auto">
							{prompt}
						</pre>
					) : (
						<p className="whitespace-pre-wrap text-sm text-stone-800 dark:text-stone-200 leading-relaxed max-h-[640px] overflow-y-auto">
							{text}
						</p>
					)
				) : (
					<div className="text-sm text-stone-500 dark:text-stone-400">
						{getMessage().AGENTS_DEFINITION_NO_SYSTEM_PROMPT}
					</div>
				)}
			</div>
		</div>
	);
}
