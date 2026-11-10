import { useEffect, useState } from "react";
import { Info, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import getMessage from "@/constants/messages";
import {
	SPAN_SEARCH_ATTRIBUTES,
	SPAN_SEARCH_EVENT_ATTRIBUTES,
	SPAN_SEARCH_JSON_ATTRIBUTES,
	SPAN_SEARCH_MAX_LENGTH,
} from "@/constants/traces";

function FieldList({ title, keys }: { title: string; keys: string[] }) {
	return (
		<div>
			<p className="font-medium text-stone-700 dark:text-stone-300">{title}</p>
			<ul className="mt-0.5 font-mono text-[11px] text-stone-600 dark:text-stone-400">
				{keys.map((key) => (
					<li key={key}>{key}</li>
				))}
			</ul>
		</div>
	);
}

function SearchCoverage() {
	const m = getMessage();
	return (
		<TooltipProvider delayDuration={150}>
			<Tooltip>
				<TooltipTrigger asChild>
					<button
						type="button"
						aria-label={m.OBSERVABILITY_SPAN_SEARCH_INFO_LABEL}
						className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300"
					>
						<Info className="h-3 w-3" />
					</button>
				</TooltipTrigger>
				<TooltipContent align="end" className="max-w-xs space-y-2 text-xs">
					<p className="text-stone-600 dark:text-stone-400">
						{m.OBSERVABILITY_SPAN_SEARCH_INFO_MATCHING}
					</p>
					<FieldList
						title={m.OBSERVABILITY_SPAN_SEARCH_INFO_SPAN_ATTRIBUTES}
						keys={[...SPAN_SEARCH_JSON_ATTRIBUTES, ...SPAN_SEARCH_ATTRIBUTES]}
					/>
					<FieldList
						title={m.OBSERVABILITY_SPAN_SEARCH_INFO_EVENT_ATTRIBUTES}
						keys={SPAN_SEARCH_EVENT_ATTRIBUTES}
					/>
					<p className="font-medium text-stone-700 dark:text-stone-300">
						{m.OBSERVABILITY_SPAN_SEARCH_INFO_STATUS}
					</p>
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
}

export default function SpanContentSearch({
	value,
	onSubmit,
}: {
	value: string;
	onSubmit: (search: string) => void;
}) {
	const [draft, setDraft] = useState(value);

	useEffect(() => {
		setDraft(value);
	}, [value]);

	return (
		<div className="relative w-44 shrink-0">
			<Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-stone-500 dark:text-stone-400" />
			<Input
				aria-label={getMessage().OBSERVABILITY_SPAN_SEARCH_PLACEHOLDER}
				placeholder={getMessage().OBSERVABILITY_SPAN_SEARCH_PLACEHOLDER}
				value={draft}
				maxLength={SPAN_SEARCH_MAX_LENGTH}
				onChange={(event) => setDraft(event.target.value)}
				onKeyDown={(event) => {
					if (event.key !== "Enter") return;
					const next = draft.trim();
					if (next !== value) onSubmit(next);
				}}
				className="h-[30px] pl-6 pr-6 text-xs text-stone-700 focus-visible:ring-0 focus-visible:ring-offset-0 dark:bg-stone-800 dark:text-stone-300"
			/>
			<SearchCoverage />
		</div>
	);
}
