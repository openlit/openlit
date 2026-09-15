"use client";

import { useCallback, useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import getMessage from "@/constants/messages";
import { getCurrentOrganisation } from "@/selectors/organisation";
import {
	getCurrentProject,
	getCurrentProjectEnvironment,
} from "@/selectors/project";
import { useRootStore } from "@/store";

type ContextItem = {
	label: string;
	value?: string | null;
};

function truncateValue(value: string) {
	if (value.length <= 22) return value;
	return `${value.slice(0, 10)}…${value.slice(-6)}`;
}

function CopyableContextChip({ label, value }: ContextItem) {
	const messages = getMessage();
	const [copied, setCopied] = useState(false);

	const onCopy = useCallback(() => {
		if (!value) return;
		void navigator.clipboard.writeText(value).then(
			() => {
				toast.success(messages.COPIED_TO_CLIPBOARD);
				setCopied(true);
				window.setTimeout(() => setCopied(false), 1500);
			},
			() => undefined
		);
	}, [messages.COPIED_TO_CLIPBOARD, value]);

	if (!value) return null;

	return (
		<span className="inline-flex max-w-full items-center gap-1 rounded-md border border-stone-200 bg-stone-50 px-1.5 py-0.5 text-[11px] text-stone-600 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300">
			<span className="shrink-0 font-medium text-stone-500 dark:text-stone-400">
				{label}
			</span>
			<span className="min-w-0 truncate font-mono text-stone-800 dark:text-stone-100" title={value}>
				{truncateValue(value)}
			</span>
			<button
				type="button"
				className="shrink-0 rounded p-0.5 text-stone-400 hover:bg-stone-200/80 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
				title={messages.COPY_CONTEXT_VALUE(label)}
				aria-label={messages.COPY_CONTEXT_VALUE(label)}
				onClick={onCopy}
			>
				{copied ? (
					<Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
				) : (
					<Copy className="h-3 w-3" />
				)}
			</button>
		</span>
	);
}

/**
 * Compact, copyable Organisation → Project → Environment IDs for API clients
 * (signal-routing headers). Hide when none of the values are available.
 */
export default function OpenLitContextIds({
	className = "",
}: {
	className?: string;
}) {
	const messages = getMessage();
	const organisation = useRootStore(getCurrentOrganisation);
	const project = useRootStore(getCurrentProject);
	const environment = useRootStore(getCurrentProjectEnvironment);

	const items: ContextItem[] = [
		{ label: messages.ORGANISATION_ID, value: organisation?.id },
		{ label: messages.PROJECT_ID, value: project?.id },
		{ label: messages.ENVIRONMENT_NAME, value: environment || undefined },
	].filter((item) => Boolean(item.value));

	if (items.length === 0) return null;

	return (
		<div
			className={`flex flex-wrap items-center gap-1.5 ${className}`}
			data-testid="openlit-context-ids"
		>
			{items.map((item) => (
				<CopyableContextChip key={item.label} {...item} />
			))}
		</div>
	);
}
