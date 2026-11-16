"use client";

function lineTone(line: string): string {
	if (line.startsWith("@@")) {
		return "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300";
	}
	if (line.startsWith("+")) {
		return "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300";
	}
	if (line.startsWith("-")) {
		return "bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300";
	}
	return "text-stone-700 dark:text-stone-300";
}

/** Unified diff of one Enrich run, without the `---`/`+++` file headers. */
export default function ScannerEnrichDiff({ diff, path }: { diff: string; path?: string }) {
	// Counted here because enrich-result's diffStats lives in server-side code.
	const lines = diff
		.split("\n")
		.filter((line, index, all) => !(index === all.length - 1 && line === ""))
		.filter((line) => !line.startsWith("--- ") && !line.startsWith("+++ "));
	const additions = lines.filter((line) => line.startsWith("+")).length;
	const deletions = lines.filter((line) => line.startsWith("-")).length;

	return (
		<div className="overflow-hidden rounded-md border border-stone-200 dark:border-stone-800">
			<div className="flex items-center justify-between gap-2 border-b border-stone-200 bg-stone-50 px-3 py-1.5 dark:border-stone-800 dark:bg-stone-900">
				<span className="truncate font-mono text-[11px] text-stone-700 dark:text-stone-300">{path}</span>
				<span className="shrink-0 font-mono text-[11px]">
					<span className="text-emerald-700 dark:text-emerald-400">+{additions}</span>{" "}
					<span className="text-rose-700 dark:text-rose-400">−{deletions}</span>
				</span>
			</div>
			<pre className="max-h-96 overflow-auto bg-white py-1 font-mono text-[11px] leading-5 dark:bg-stone-950">
				{lines.map((line, index) => (
					<div key={index} className={`whitespace-pre px-3 ${lineTone(line)}`}>
						{line || " "}
					</div>
				))}
			</pre>
		</div>
	);
}
