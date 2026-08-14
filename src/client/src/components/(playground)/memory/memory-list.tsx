"use client";

import { useEffect, useMemo, useRef } from "react";
import { format } from "date-fns";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import getMessage from "@/constants/messages";
import type { MemoryListItem } from "@/lib/platform/connectors/memory/read";
import type { MemoryKind } from "@/lib/platform/connectors/memory/graph";

const KIND_DOT: Record<MemoryKind, string> = {
	temporal: "bg-teal-500",
	profile: "bg-orange-500",
	summary: "bg-lime-500",
};

type MemoryListProps = {
	memories: MemoryListItem[];
	search: string;
	onSearchChange: (value: string) => void;
	selectedId?: string | null;
	onSelect: (id: string) => void;
};

export default function MemoryList({
	memories,
	search,
	onSearchChange,
	selectedId,
	onSelect,
}: MemoryListProps) {
	const messages = getMessage();
	const selectedRef = useRef<HTMLButtonElement | null>(null);
	const query = search.trim().toLowerCase();
	const filtered = useMemo(() => {
		if (!query) return memories;
		return memories.filter((memory) =>
			[memory.content, memory.userId, memory.sessionId, memory.agentId, memory.kind]
				.filter(Boolean)
				.some((value) => String(value).toLowerCase().includes(query))
		);
	}, [memories, query]);

	useEffect(() => {
		selectedRef.current?.scrollIntoView({ block: "nearest" });
	}, [selectedId]);

	return (
		<section className="flex h-full min-h-0 flex-col border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950">
			<div className="border-b border-stone-200 px-3 py-2 dark:border-stone-800">
				<h2 className="text-sm font-semibold text-stone-950 dark:text-stone-50">
					{messages.MEMORY_LIST_TITLE}
				</h2>
				<div className="relative mt-2">
					<Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-stone-400" />
					<Input
						value={search}
						onChange={(event) => onSearchChange(event.target.value)}
						placeholder={messages.MEMORY_SEARCH_PLACEHOLDER}
						className="h-8 pl-7"
					/>
				</div>
			</div>
			<div className="min-h-0 flex-1 overflow-auto">
				{filtered.length === 0 ? (
					<p className="px-3 py-6 text-center text-xs text-stone-500 dark:text-stone-400">
						{memories.length === 0 ? messages.MEMORY_EMPTY_LIST : messages.MEMORY_NO_MATCHES}
					</p>
				) : (
					<ul className="divide-y divide-stone-200 dark:divide-stone-800">
						{filtered.map((memory) => {
							const selected = memory.id === selectedId;
							const kindLabel = kindMessage(messages, memory.kind);
							return (
								<li key={memory.id}>
									<button
										type="button"
										ref={selected ? selectedRef : undefined}
										onClick={() => onSelect(memory.id)}
										className={`flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-stone-50 dark:hover:bg-stone-900 ${
											selected ? "bg-stone-100 dark:bg-stone-900" : ""
										}`}
									>
										<span className={`mt-1 size-2 shrink-0 rounded-full ${KIND_DOT[memory.kind]}`} />
										<span className="min-w-0 flex-1">
											<span className="block truncate text-sm font-medium text-stone-900 dark:text-stone-100">
												{titleFor(memory.content)}
											</span>
											<span className="mt-0.5 block truncate text-[11px] text-stone-500 dark:text-stone-400">
												{kindLabel}
												{memory.userId ? ` · ${memory.userId}` : ""}
												{memory.sessionId ? ` · ${memory.sessionId}` : ""}
												{" · "}
												{formatDate(memory.createdAt || memory.updatedAt, messages.MEMORY_NO_DATE)}
											</span>
										</span>
									</button>
								</li>
							);
						})}
					</ul>
				)}
			</div>
		</section>
	);
}

function titleFor(content: string): string {
	const line = content.split(/\n/)[0]?.trim() || content;
	return line.length > 72 ? `${line.slice(0, 69).trimEnd()}…` : line;
}

function formatDate(value: string | undefined, fallback: string): string {
	if (!value) return fallback;
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) return fallback;
	return format(parsed, "MM-dd");
}

function kindMessage(
	messages: ReturnType<typeof getMessage>,
	kind: MemoryKind
): string {
	if (kind === "temporal") return messages.MEMORY_TEMPORAL;
	if (kind === "profile") return messages.MEMORY_PROFILE;
	return messages.MEMORY_SUMMARY;
}
