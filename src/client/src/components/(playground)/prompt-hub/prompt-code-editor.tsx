"use client";

import { Textarea } from "@/components/ui/textarea";
import { useMemo, useRef, useState } from "react";

export default function PromptCodeEditor({
	value,
	onChange,
	placeholder,
}: {
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
}) {
	const gutterRef = useRef<HTMLDivElement>(null);
	const [scrollTop, setScrollTop] = useState(0);
	const lineCount = useMemo(
		() => Math.max(1, value.split("\n").length),
		[value]
	);

	return (
		<div className="relative h-full min-h-[300px] overflow-hidden rounded-md border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
			<div
				ref={gutterRef}
				className="pointer-events-none absolute bottom-0 left-0 top-0 w-9 overflow-hidden border-r border-stone-200 bg-stone-50 py-3 text-right font-mono text-xs leading-6 text-stone-400 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-600"
			>
				<div style={{ transform: `translateY(-${scrollTop}px)` }}>
					{Array.from({ length: lineCount }, (_, index) => (
						<div key={index} className="h-6 pr-1.5">
							{index + 1}
						</div>
					))}
				</div>
			</div>
			<Textarea
				value={value}
				onChange={(event) => onChange(event.target.value)}
				onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
				placeholder={placeholder}
				spellCheck={false}
				className="h-full min-h-[300px] resize-none rounded-none border-0 bg-transparent py-3 pl-12 pr-4 font-mono text-sm leading-6 text-stone-900 shadow-none outline-none ring-0 focus-visible:ring-0 dark:text-stone-100 dark:placeholder:text-stone-500"
			/>
		</div>
	);
}
