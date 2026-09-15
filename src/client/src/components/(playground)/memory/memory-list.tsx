"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
	Pagination,
	PaginationContent,
	PaginationItem,
	PaginationNext,
	PaginationPrevious,
} from "@/components/ui/pagination";
import getMessage from "@/constants/messages";
import type { MemoryListItem } from "@/lib/platform/connectors/memory/read";
import type { MemoryKind } from "@/lib/platform/connectors/memory/graph";

const KIND_DOT: Record<MemoryKind, string> = {
	temporal: "bg-teal-500",
	profile: "bg-orange-500",
	summary: "bg-lime-500",
};

const PAGE_SIZE = 20;

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
	const jumpedForId = useRef<string | null>(null);
	const [page, setPage] = useState(1);
	const query = search.trim().toLowerCase();
	const filtered = useMemo(() => {
		if (!query) return memories;
		return memories.filter((memory) =>
			[memory.content, memory.userId, memory.sessionId, memory.agentId, memory.kind]
				.filter(Boolean)
				.some((value) => String(value).toLowerCase().includes(query))
		);
	}, [memories, query]);
	const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
	const currentPage = Math.min(page, totalPages);
	const pageItems = filtered.slice(
		(currentPage - 1) * PAGE_SIZE,
		currentPage * PAGE_SIZE
	);

	useEffect(() => {
		jumpedForId.current = null;
		setPage(1);
	}, [query]);

	useEffect(() => {
		if (!selectedId) {
			jumpedForId.current = null;
			return;
		}
		const index = filtered.findIndex((memory) => memory.id === selectedId);
		if (index < 0) return;
		if (jumpedForId.current === selectedId) return;
		jumpedForId.current = selectedId;
		setPage(Math.floor(index / PAGE_SIZE) + 1);
	}, [filtered, selectedId]);

	useEffect(() => {
		if (typeof selectedRef.current?.scrollIntoView !== "function") return;
		selectedRef.current.scrollIntoView({ block: "nearest" });
	}, [selectedId, currentPage]);

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
						{pageItems.map((memory) => {
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
											{memory.port ? (
												<span className="mt-0.5 block truncate text-[11px] text-violet-700 dark:text-violet-300">
													{messages.MEMORY_COPY_SOURCE}
													{" · "}
													{memory.port.sourceConnectorName || memory.port.sourceConnectorId}
												</span>
											) : null}
										</span>
									</button>
								</li>
							);
						})}
					</ul>
				)}
			</div>
			{filtered.length > PAGE_SIZE ? (
				<div className="flex shrink-0 items-center justify-end border-t border-stone-200 px-2 py-1.5 dark:border-stone-800">
					<Pagination className="m-0 w-auto">
						<PaginationContent className="gap-0.5">
							<PaginationItem>
								<PaginationPrevious
									className={`h-7 px-2 py-1 ${
										currentPage === 1
											? "pointer-events-none cursor-not-allowed text-stone-400"
											: "text-stone-950 dark:text-stone-100"
									}`}
									aria-label={messages.MEMORY_PAGE_PREVIOUS}
									aria-disabled={currentPage === 1}
									onClick={() => setPage((value) => Math.max(1, value - 1))}
								/>
							</PaginationItem>
							<PaginationItem>
								<div className="flex items-center whitespace-nowrap px-1 text-xs text-stone-950 dark:text-stone-100">
									{messages.MEMORY_PAGE_OF(currentPage, totalPages)}
								</div>
							</PaginationItem>
							<PaginationItem>
								<PaginationNext
									className={`h-7 px-2 py-1 ${
										currentPage >= totalPages
											? "pointer-events-none cursor-not-allowed text-stone-400"
											: "text-stone-950 dark:text-stone-100"
									}`}
									aria-label={messages.MEMORY_PAGE_NEXT}
									aria-disabled={currentPage >= totalPages}
									onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
								/>
							</PaginationItem>
						</PaginationContent>
					</Pagination>
				</div>
			) : null}
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
