import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import getMessage from "@/constants/messages";
import { SPAN_SEARCH_MAX_LENGTH } from "@/constants/traces";

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
				className="h-[30px] pl-6 pr-2 text-xs text-stone-700 dark:bg-stone-800 dark:text-stone-300"
			/>
		</div>
	);
}
