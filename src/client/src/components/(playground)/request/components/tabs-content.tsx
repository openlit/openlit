import { objectEntries } from "@/utils/object";
import { isArray, isPlainObject } from "lodash";
import { AttrRow } from "./attributes-tab";

export default function TabsContent({
	dataKey,
	dataValue,
}: {
	dataKey: string;
	dataValue: Record<string, any> | string[] | Record<string, any>[];
}) {
	const content = isArray(dataValue)
		? dataValue.map((datumValue, index) => (
			<section key={`${dataKey}-${index}`} className="flex flex-col">
				{index !== 0 ? (
					<div className="h-px bg-stone-200 dark:bg-stone-700" />
				) : null}
				{isPlainObject(datumValue) ? (
					objectEntries(datumValue).map(([key, value]) => (
						<AttrRow
							key={key.toString()}
							label={key as string}
							value={value}
						/>
					))
				) : (
					<AttrRow
						key={`${dataKey}-${index}-val`}
						label={typeof datumValue === "string" ? datumValue : `[${index}]`}
						value={typeof datumValue === "string" ? "" : datumValue}
					/>
				)}
			</section>
		))
		: objectEntries(dataValue).map(([key, value]) => (
			<AttrRow
				key={key.toString()}
				label={key as string}
				value={value}
			/>
		));

	return <div className="flex flex-col">{content}</div>;
}
