"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { Loader2, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import getMessage from "@/constants/messages";
import { getRequestHeaders } from "@/utils/api";
import { cn } from "@/lib/utils";

export type AskOtterCopy = {
	title: string;
	empty: string;
	placeholder: string;
	hint: string;
	send: string;
	conversationTitle?: string;
};

export type AskOtterPanelProps = {
	/** Disable ask when the host page has no usable context (e.g. no connectors). */
	disabled?: boolean;
	/** Page-owned strings so the same panel can sit on Memory, traces, etc. */
	copy: AskOtterCopy;
	/** Host builds the chat prompt (filters, selected item, system instructions). */
	buildPrompt: (question: string) => string;
	/** Optional chip for the currently selected item on the host page. */
	contextLabel?: string | null;
	/**
	 * `dock` — compact bottom strip.
	 * `fill` — full-height column for side panels / resizable hosts.
	 */
	layout?: "dock" | "fill";
	className?: string;
};

type AskMessage = {
	id: string;
	role: "user" | "assistant";
	content: string;
	steps?: string[];
};

export default function AskOtterPanel({
	disabled,
	copy,
	buildPrompt,
	contextLabel,
	layout = "dock",
	className,
}: AskOtterPanelProps) {
	const messages = getMessage();
	const [question, setQuestion] = useState("");
	const [hasConfig, setHasConfig] = useState<boolean | null>(null);
	const [thread, setThread] = useState<AskMessage[]>([]);
	const [streaming, setStreaming] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const conversationIdRef = useRef<string | null>(null);
	const abortRef = useRef<AbortController | null>(null);
	const listRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		let cancelled = false;
		fetch("/api/chat/config")
			.then((response) => response.json())
			.then((body) => {
				if (!cancelled) setHasConfig(!!body?.data?.provider);
			})
			.catch(() => {
				if (!cancelled) setHasConfig(false);
			});
		return () => {
			cancelled = true;
			abortRef.current?.abort();
		};
	}, []);

	useEffect(() => {
		listRef.current?.scrollTo?.({ top: listRef.current.scrollHeight });
	}, [thread, streaming]);

	const ensureConversation = useCallback(async (): Promise<string | null> => {
		if (conversationIdRef.current) return conversationIdRef.current;
		const response = await fetch("/api/chat/conversation", {
			method: "POST",
			headers: getRequestHeaders({ "Content-Type": "application/json" }),
			body: JSON.stringify({
				title: copy.conversationTitle || copy.title,
				provider: "",
				model: "",
			}),
		});
		const body = await response.json().catch(() => null);
		const id = typeof body?.data === "string" ? body.data : body?.data?.id;
		if (!response.ok || !id) {
			throw new Error(
				typeof body === "string"
					? body
					: body?.err || messages.CHAT_FAILED_TO_CREATE_CONVERSATION
			);
		}
		conversationIdRef.current = String(id);
		return conversationIdRef.current;
	}, [
		copy.conversationTitle,
		copy.title,
		messages.CHAT_FAILED_TO_CREATE_CONVERSATION,
	]);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		const text = question.trim();
		if (!text || disabled || streaming || hasConfig === false) return;
		setError(null);
		setQuestion("");
		const userMessage: AskMessage = {
			id: `user-${Date.now()}`,
			role: "user",
			content: text,
		};
		const assistantId = `assistant-${Date.now()}`;
		setThread((current) => [
			...current,
			userMessage,
			{ id: assistantId, role: "assistant", content: "", steps: [] },
		]);
		setStreaming(true);

		try {
			const conversationId = await ensureConversation();
			if (!conversationId) throw new Error(messages.CHAT_FAILED_TO_CREATE_CONVERSATION);
			const controller = new AbortController();
			abortRef.current = controller;
			const response = await fetch("/api/chat/message", {
				method: "POST",
				headers: getRequestHeaders({ "Content-Type": "application/json" }),
				body: JSON.stringify({
					conversationId,
					content: buildPrompt(text),
				}),
				signal: controller.signal,
			});
			if (!response.ok) {
				const errText = await response.text();
				throw new Error(errText || messages.CHAT_FAILED_TO_GET_RESPONSE);
			}
			const reader = response.body?.getReader();
			if (!reader) throw new Error(messages.CHAT_NO_RESPONSE_STREAM);
			const decoder = new TextDecoder();
			let fullText = "";
			let buffer = "";
			const steps: string[] = [];
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";
				for (const line of lines) {
					if (!line.trim()) continue;
					try {
						const eventLine = JSON.parse(line) as {
							type?: string;
							text?: string;
							label?: string;
							error?: string;
						};
						if (eventLine.type === "step" && eventLine.label) {
							steps.push(eventLine.label);
							setThread((current) =>
								current.map((item) =>
									item.id === assistantId ? { ...item, steps: [...steps] } : item
								)
							);
							continue;
						}
						if (eventLine.type === "delta") {
							fullText += eventLine.text || "";
							setThread((current) =>
								current.map((item) =>
									item.id === assistantId ? { ...item, content: fullText } : item
								)
							);
							continue;
						}
						if (eventLine.type === "error") {
							throw new Error(eventLine.error || messages.CHAT_SOMETHING_WENT_WRONG);
						}
					} catch (parseError) {
						if (parseError instanceof SyntaxError) {
							fullText += line;
							setThread((current) =>
								current.map((item) =>
									item.id === assistantId ? { ...item, content: fullText } : item
								)
							);
						} else {
							throw parseError;
						}
					}
				}
			}
		} catch (caught) {
			if ((caught as { name?: string })?.name === "AbortError") return;
			const message =
				caught instanceof Error ? caught.message : messages.CHAT_SOMETHING_WENT_WRONG;
			setError(message);
			setThread((current) =>
				current.map((item) =>
					item.id === assistantId
						? {
								...item,
								content: item.content || `**${messages.CHAT_ERROR_PREFIX}** ${message}`,
							}
						: item
				)
			);
		} finally {
			setStreaming(false);
			abortRef.current = null;
		}
	};

	const blocked = disabled || hasConfig === false || streaming;

	return (
		<section
			className={cn(
				"flex min-h-0 flex-col bg-stone-50 dark:bg-stone-900",
				layout === "fill"
					? "h-full border-0"
					: "border-t border-stone-200 dark:border-stone-800",
				className
			)}
		>
			<div className="flex shrink-0 items-center gap-1.5 border-b border-stone-200 px-3 py-2.5 dark:border-stone-800">
				<Sparkles className="size-3.5 text-violet-600 dark:text-violet-300" />
				<p className="min-w-0 flex-1 truncate text-sm font-semibold text-stone-900 dark:text-stone-50">
					{copy.title}
				</p>
				{contextLabel ? (
					<p
						title={contextLabel}
						className="max-w-[55%] truncate rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
					>
						{contextLabel}
					</p>
				) : null}
			</div>
			<div
				ref={listRef}
				className={cn(
					"min-h-0 space-y-2 overflow-auto px-3 py-3",
					layout === "fill" ? "flex-1" : "max-h-44"
				)}
			>
				{thread.length === 0 ? (
					<p className="text-xs leading-5 text-stone-500 dark:text-stone-400">
						{copy.empty}
					</p>
				) : (
					thread.map((item) => (
						<div
							key={item.id}
							className={`rounded-md px-2.5 py-1.5 text-xs ${
								item.role === "user"
									? "bg-stone-100 text-stone-800 dark:bg-stone-900 dark:text-stone-200"
									: "text-stone-700 dark:text-stone-300"
							}`}
						>
							{item.role === "assistant" && item.steps?.length ? (
								<p className="mb-1 text-[10px] uppercase tracking-wide text-stone-400">
									{item.steps[item.steps.length - 1]}
								</p>
							) : null}
							{item.role === "assistant" ? (
								<div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1 prose-pre:my-1">
									<ReactMarkdown>{item.content || (streaming ? "…" : "")}</ReactMarkdown>
								</div>
							) : (
								<p>{item.content}</p>
							)}
						</div>
					))
				)}
			</div>
			<div className="shrink-0 border-t border-stone-200 px-3 py-3 dark:border-stone-800">
				{hasConfig === false ? (
					<p className="mb-2 text-xs text-amber-800 dark:text-amber-200">
						{messages.CHAT_CONFIGURE_PROVIDER}{" "}
						<Link href="/chat/settings" className="underline font-medium">
							{messages.CHAT_SETTINGS_LINK}
						</Link>{" "}
						{messages.CHAT_TO_GET_STARTED}
					</p>
				) : null}
				{error && hasConfig !== false ? (
					<p className="mb-2 text-xs text-error">{error}</p>
				) : null}
				<form onSubmit={submit} className="flex items-center gap-2">
					<Input
						value={question}
						onChange={(event) => setQuestion(event.target.value)}
						placeholder={copy.placeholder}
						disabled={blocked || hasConfig === null}
						className="h-9"
					/>
					<Button
						type="submit"
						size="sm"
						disabled={blocked || hasConfig === null || !question.trim()}
						className="shrink-0 gap-1.5"
					>
						{streaming ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
						{copy.send}
					</Button>
				</form>
				<p className="mt-1.5 text-[11px] text-stone-500 dark:text-stone-400">
					{copy.hint}
				</p>
			</div>
		</section>
	);
}
