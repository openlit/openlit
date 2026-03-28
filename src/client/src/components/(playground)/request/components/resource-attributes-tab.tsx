"use client";

import { isNil } from "lodash";
import { AttrRow } from "./attributes-tab";

export default function ResourceAttributesTab({
	resourceAttributes,
}: {
	resourceAttributes: Record<string, string>;
}) {
	const entries = Object.entries(resourceAttributes || {}).filter(
		([, value]) => !isNil(value) && String(value).length > 0
	);

	if (entries.length === 0) {
		return (
			<div className="flex items-center justify-center h-16 text-sm text-stone-400 dark:text-stone-500">
				No resource attributes
			</div>
		);
	}

	return (
		<div className="flex flex-col">
			{entries.map(([key, value]) => (
				<AttrRow key={key} label={key} value={String(value)} />
			))}
		</div>
	);
}
