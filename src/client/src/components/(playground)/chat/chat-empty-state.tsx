"use client";

import {
	MessageSquare,
	LayoutDashboard,
	CircleDollarSign,
	SlidersHorizontal,
	LineChart,
	Component,
	BookKey,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import getMessage from "@/constants/messages";
import Otter from "@/components/svg/otter";

interface ChatEmptyStateProps {
	onSendQuestion: (question: string) => void;
	hasConfig: boolean;
}

const EXAMPLE_ICONS = [
	LayoutDashboard,
	CircleDollarSign,
	SlidersHorizontal,
	LineChart,
	Component,
	BookKey,
];

export default function ChatEmptyState({
	onSendQuestion,
	hasConfig,
}: ChatEmptyStateProps) {
	const m = getMessage();
	const examples = [
		m.CHAT_EXAMPLE_Q1,
		m.CHAT_EXAMPLE_Q2,
		m.CHAT_EXAMPLE_Q3,
		m.CHAT_EXAMPLE_Q4,
		m.CHAT_EXAMPLE_Q5,
		m.CHAT_EXAMPLE_Q6,
	];

	return (
		<div className="flex flex-col items-center justify-center flex-1 px-6 py-12">
			<div className="flex items-center justify-center w-16 h-16 rounded-full bg-stone-200 dark:bg-stone-200 mb-5">
				{/* <MessageSquare className="w-7 h-7 text-orange-600 dark:text-orange-400" /> */}
				<Otter className="w-12 h-12 text-stone-800 dark:text-stone-800" />
			</div>
			<h2 className="text-xl font-semibold text-stone-900 dark:text-stone-100 mb-1.5">
				{m.CHAT_EMPTY_TITLE}
			</h2>
			<p className="text-sm text-stone-500 dark:text-stone-400 text-center max-w-lg mb-8">
				{m.CHAT_EMPTY_DESCRIPTION}
			</p>

			{!hasConfig && (
				<div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-3 mb-8 max-w-md text-center">
					<p className="text-sm text-amber-800 dark:text-amber-200">
						{m.CHAT_CONFIGURE_PROVIDER}{" "}
						<a
							href="/chat/settings"
							className="underline font-medium hover:text-amber-900 dark:hover:text-amber-100"
						>
							{m.CHAT_SETTINGS_LINK}
						</a>{" "}
						{m.CHAT_TO_GET_STARTED}
					</p>
				</div>
			)}

			<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 max-w-3xl w-full">
				{examples.map((question, i) => {
					const Icon = EXAMPLE_ICONS[i];
					return (
						<Button
							key={question}
							variant="outline"
							className="h-auto py-3 px-3.5 text-left justify-start gap-2.5 text-sm font-normal text-stone-600 dark:text-stone-300 border-stone-200 dark:border-stone-700 hover:bg-stone-50 dark:hover:bg-stone-800 hover:border-stone-300 dark:hover:border-stone-600 whitespace-normal transition-colors"
							onClick={() => onSendQuestion(question)}
							disabled={!hasConfig}
						>
							<Icon className="h-4 w-4 shrink-0 text-stone-400 dark:text-stone-500" />
							<span className="line-clamp-2">{question}</span>
						</Button>
					);
				})}
			</div>
		</div>
	);
}
