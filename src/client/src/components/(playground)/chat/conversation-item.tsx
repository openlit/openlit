"use client";

import { useState } from "react";
import { Trash2, Coins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import getMessage from "@/constants/messages";
import { formatDistanceToNow } from "date-fns";

interface ConversationItemProps {
	id: string;
	title: string;
	totalCost: number;
	totalMessages: number;
	updatedAt: string;
	isActive: boolean;
	onClick: () => void;
	onDelete: () => void;
}

export default function ConversationItem({
	title,
	totalCost,
	updatedAt,
	isActive,
	onClick,
	onDelete,
}: ConversationItemProps) {
	const [showDelete, setShowDelete] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const messages = getMessage();

	const timeAgo = (() => {
		try {
			return formatDistanceToNow(new Date(updatedAt), { addSuffix: true });
		} catch {
			return "";
		}
	})();

	const handleDelete = (e: React.MouseEvent) => {
		e.stopPropagation();
		if (confirming) {
			onDelete();
			setConfirming(false);
		} else {
			setConfirming(true);
			setTimeout(() => setConfirming(false), 3000);
		}
	};

	return (
		<div
			onClick={onClick}
			onMouseEnter={() => setShowDelete(true)}
			onMouseLeave={() => {
				setShowDelete(false);
				setConfirming(false);
			}}
			className={cn(
				"group flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer transition-colors",
				isActive
					? "bg-stone-200/70 dark:bg-stone-800"
					: "hover:bg-stone-100 dark:hover:bg-stone-800/50"
			)}
		>
			<div className="flex-1 min-w-0">
				<p className="text-sm font-medium text-stone-800 dark:text-stone-200 truncate">
					{title || messages.CHAT_NEW_CONVERSATION}
				</p>
				<div className="flex items-center gap-2 mt-0.5">
					<span className="text-xs text-stone-400 dark:text-stone-500">
						{timeAgo}
					</span>
					{totalCost > 0 && (
						<span className="flex items-center gap-0.5 text-xs text-stone-400 dark:text-stone-500">
							<Coins className="h-2.5 w-2.5" />
							${totalCost.toFixed(4)}
						</span>
					)}
				</div>
			</div>

			{showDelete && (
				<Button
					variant="ghost"
					size="icon"
					className={cn(
						"h-7 w-7 shrink-0",
						confirming
							? "text-red-500 dark:text-red-400"
							: "text-stone-400 hover:text-red-500 dark:hover:text-red-400"
					)}
					onClick={handleDelete}
				>
					<Trash2 className="h-3.5 w-3.5" />
				</Button>
			)}
		</div>
	);
}
