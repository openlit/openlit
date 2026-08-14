"use client";

import Link from "next/link";
import {
	SlidersHorizontal,
	BookOpen,
	BookKey,
	Component,
	SettingsIcon,
	MonitorCog,
	ExternalLink,
} from "lucide-react";

const ENTITY_ICONS: Record<string, React.ElementType> = {
	rule: SlidersHorizontal,
	context: BookOpen,
	prompt: Component,
	model: SettingsIcon,
	evaluation: MonitorCog,
	vault: BookKey,
};

const ENTITY_COLORS: Record<string, { bg: string; border: string; icon: string; text: string }> = {
	rule: {
		bg: "bg-purple-50 dark:bg-purple-950/20",
		border: "border-purple-200 dark:border-purple-800",
		icon: "text-purple-600 dark:text-purple-400",
		text: "text-purple-700 dark:text-purple-300",
	},
	context: {
		bg: "bg-blue-50 dark:bg-blue-950/20",
		border: "border-blue-200 dark:border-blue-800",
		icon: "text-blue-600 dark:text-blue-400",
		text: "text-blue-700 dark:text-blue-300",
	},
	prompt: {
		bg: "bg-green-50 dark:bg-green-950/20",
		border: "border-green-200 dark:border-green-800",
		icon: "text-green-600 dark:text-green-400",
		text: "text-green-700 dark:text-green-300",
	},
	model: {
		bg: "bg-orange-50 dark:bg-orange-950/20",
		border: "border-orange-200 dark:border-orange-800",
		icon: "text-orange-600 dark:text-orange-400",
		text: "text-orange-700 dark:text-orange-300",
	},
	evaluation: {
		bg: "bg-yellow-50 dark:bg-yellow-950/20",
		border: "border-yellow-200 dark:border-yellow-800",
		icon: "text-yellow-600 dark:text-yellow-400",
		text: "text-yellow-700 dark:text-yellow-300",
	},
	vault: {
		bg: "bg-rose-50 dark:bg-rose-950/20",
		border: "border-rose-200 dark:border-rose-800",
		icon: "text-rose-600 dark:text-rose-400",
		text: "text-rose-700 dark:text-rose-300",
	},
};

const DEFAULT_COLORS = {
	bg: "bg-stone-50 dark:bg-stone-800",
	border: "border-stone-200 dark:border-stone-700",
	icon: "text-stone-500 dark:text-stone-400",
	text: "text-stone-700 dark:text-stone-300",
};

interface EntityCardProps {
	type: string;
	name: string;
	url: string;
}

export default function EntityCard({ type, name, url }: EntityCardProps) {
	const Icon = ENTITY_ICONS[type] || ExternalLink;
	const colors = ENTITY_COLORS[type] || DEFAULT_COLORS;
	const label = type.charAt(0).toUpperCase() + type.slice(1);

	return (
		<Link href={url} className="block no-underline">
			<div
				className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border ${colors.bg} ${colors.border} hover:shadow-sm transition-shadow cursor-pointer group mt-2`}
			>
				<div className={`flex-shrink-0 p-1.5 rounded-md ${colors.bg}`}>
					<Icon className={`h-4 w-4 ${colors.icon}`} />
				</div>
				<div className="flex-1 min-w-0">
					<p className={`text-xs font-medium ${colors.text} uppercase tracking-wide`}>
						{label}
					</p>
					<p className="text-sm font-medium text-stone-900 dark:text-stone-100 truncate">
						{name || label}
					</p>
				</div>
				<ExternalLink className="h-3.5 w-3.5 text-stone-400 dark:text-stone-500 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
			</div>
		</Link>
	);
}
