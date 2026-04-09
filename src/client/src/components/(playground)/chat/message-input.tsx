"use client";

import { useRef, useCallback, useEffect, KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Send, Loader2 } from "lucide-react";
import getMessage from "@/constants/messages";

interface MessageInputProps {
	value: string;
	onChange: (value: string) => void;
	onSubmit: () => void;
	isLoading: boolean;
	disabled?: boolean;
}

const MAX_TEXTAREA_HEIGHT = 150;

export default function MessageInput({
	value,
	onChange,
	onSubmit,
	isLoading,
	disabled = false,
}: MessageInputProps) {
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const m = getMessage();

	const resizeTextarea = useCallback(() => {
		const textarea = textareaRef.current;
		if (!textarea) return;
		// Reset to auto to get the natural scrollHeight
		textarea.style.height = "auto";
		// Cap at MAX_TEXTAREA_HEIGHT — overflow becomes scrollable
		const newHeight = Math.min(textarea.scrollHeight, MAX_TEXTAREA_HEIGHT);
		textarea.style.height = `${newHeight}px`;
		// Enable scroll when content exceeds max height
		textarea.style.overflowY =
			textarea.scrollHeight > MAX_TEXTAREA_HEIGHT ? "auto" : "hidden";
	}, []);

	// Resize when value changes (including paste, programmatic set)
	useEffect(() => {
		resizeTextarea();
	}, [value, resizeTextarea]);

	const handleKeyDown = useCallback(
		(e: KeyboardEvent<HTMLTextAreaElement>) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				if (value.trim() && !isLoading && !disabled) {
					onSubmit();
				}
			}
		},
		[value, isLoading, disabled, onSubmit]
	);

	return (
		<div className="border-t border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900 p-4 shrink-0">
			<div className="flex items-end gap-3 max-w-4xl mx-auto">
				<div className="flex-1 relative">
					<textarea
						ref={textareaRef}
						value={value}
						onChange={(e) => onChange(e.target.value)}
						onKeyDown={handleKeyDown}
						placeholder={m.CHAT_ASK_QUESTION}
						disabled={disabled || isLoading}
						rows={1}
						className="w-full resize-none rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 px-4 py-3 text-sm text-stone-900 dark:text-stone-100 placeholder:text-stone-400 dark:placeholder:text-stone-500 focus:outline-none focus:ring-2 focus:ring-stone-400 dark:focus:ring-stone-600 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
						style={{
							maxHeight: `${MAX_TEXTAREA_HEIGHT}px`,
							overflowY: "hidden",
						}}
					/>
				</div>
				<Button
					onClick={onSubmit}
					disabled={!value.trim() || isLoading || disabled}
					size="icon"
					className="h-[46px] w-[46px] shrink-0 rounded-lg"
				>
					{isLoading ? (
						<Loader2 className="h-4 w-4 animate-spin" />
					) : (
						<Send className="h-4 w-4" />
					)}
				</Button>
			</div>
			<p className="text-[11px] text-stone-400 dark:text-stone-500 mt-2 text-center">
				{m.CHAT_ENTER_TO_SEND}
			</p>
		</div>
	);
}
