"use client";

import { useState, useMemo } from "react";
import { Plus, Search, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import getMessage from "@/constants/messages";
import ConversationItem from "./conversation-item";
import { useRouter } from "next/navigation";

interface Conversation {
	id: string;
	title: string;
	totalCost: number;
	totalMessages: number;
	updatedAt: string;
}

interface ConversationListProps {
	conversations: Conversation[];
	activeId: string | null;
	onSelect: (id: string) => void;
	onDelete: (id: string) => void;
	onNew: () => void;
	isLoading: boolean;
}

function groupByDate(conversations: Conversation[]) {
	const now = new Date();
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const yesterday = new Date(today.getTime() - 86400000);
	const weekAgo = new Date(today.getTime() - 7 * 86400000);

	const groups: { label: string; items: Conversation[] }[] = [
		{ label: "Today", items: [] },
		{ label: "Yesterday", items: [] },
		{ label: "Previous 7 Days", items: [] },
		{ label: "Older", items: [] },
	];

	for (const conv of conversations) {
		const date = new Date(conv.updatedAt);
		if (date >= today) {
			groups[0].items.push(conv);
		} else if (date >= yesterday) {
			groups[1].items.push(conv);
		} else if (date >= weekAgo) {
			groups[2].items.push(conv);
		} else {
			groups[3].items.push(conv);
		}
	}

	return groups.filter((g) => g.items.length > 0);
}

export default function ConversationList({
	conversations,
	activeId,
	onSelect,
	onDelete,
	onNew,
	isLoading,
}: ConversationListProps) {
	const [search, setSearch] = useState("");
	const m = getMessage();
	const router = useRouter();

	const filtered = useMemo(() => {
		if (!search.trim()) return conversations;
		const q = search.toLowerCase();
		return conversations.filter((c) => c.title.toLowerCase().includes(q));
	}, [conversations, search]);

	const groups = useMemo(() => groupByDate(filtered), [filtered]);

	return (
		<div className="flex flex-col h-full bg-stone-50 dark:bg-stone-900">
			{/* Header */}
			<div className="p-3 space-y-3 border-b border-stone-200 dark:border-stone-800">
				<div className="flex items-center gap-2">
					<Button
						onClick={onNew}
						className="flex-1 justify-center gap-2"
						size="sm"
					>
						<Plus className="h-4 w-4" />
						{m.CHAT_NEW_CHAT}
					</Button>
					<Button
						variant="outline"
						size="icon"
						className="h-8 w-8 shrink-0 border-stone-200 dark:border-stone-700"
						onClick={() => router.push("/chat/settings")}
					>
						<Settings className="h-4 w-4" />
					</Button>
				</div>
				<div className="relative">
					<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-stone-400 dark:text-stone-500" />
					<Input
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						placeholder={m.CHAT_SEARCH_CONVERSATIONS}
						className="pl-8 h-8 text-sm bg-white dark:bg-stone-800 border-stone-200 dark:border-stone-700"
					/>
				</div>
			</div>

			{/* Conversation list */}
			<div className="flex-1 overflow-y-auto px-2 py-2">
				{isLoading ? (
					<div className="space-y-2 px-1">
						{[1, 2, 3].map((i) => (
							<div
								key={i}
								className="h-14 rounded-lg bg-stone-100 dark:bg-stone-800 animate-pulse"
							/>
						))}
					</div>
				) : groups.length === 0 ? (
					<p className="text-sm text-stone-500 dark:text-stone-400 text-center mt-8 px-4">
						{search
							? m.CHAT_NO_MATCHING_CONVERSATIONS
							: m.CHAT_NO_CONVERSATIONS_YET}
					</p>
				) : (
					groups.map((group) => (
						<div key={group.label} className="mb-3">
							<p className="text-[11px] font-medium text-stone-500 dark:text-stone-400 uppercase tracking-wider px-3 mb-1">
								{group.label}
							</p>
							{group.items.map((conv) => (
								<ConversationItem
									key={conv.id}
									id={conv.id}
									title={conv.title}
									totalCost={conv.totalCost}
									totalMessages={conv.totalMessages}
									updatedAt={conv.updatedAt}
									isActive={conv.id === activeId}
									onClick={() => onSelect(conv.id)}
									onDelete={() => onDelete(conv.id)}
								/>
							))}
						</div>
					))
				)}
			</div>
		</div>
	);
}
