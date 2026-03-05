import { isNil } from "lodash";
import JsonViewer from "@/components/common/json-viewer";

export default function ContentDataItem({
	dataKey,
	dataValue,
}: {
	dataKey: string;
	dataValue?: string;
}) {
	return (
		<div className="flex items-start gap-3 px-4 py-2 border-b border-stone-100 dark:border-stone-800/60 last:border-0 hover:bg-stone-50 dark:hover:bg-stone-800/30 transition-colors">
			<span className="w-44 shrink-0 text-xs text-stone-500 dark:text-stone-400 pt-px leading-relaxed">
				{dataKey}
			</span>
			{!(isNil(dataValue) || dataValue === "") ? (
				<span className="text-xs text-stone-800 dark:text-stone-200 break-all leading-relaxed flex-1 min-w-0">
					<JsonViewer value={dataValue} />
				</span>
			) : null}
		</div>
	);
}
