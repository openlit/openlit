import { objectEntries } from "@/utils/object";
import { isArray, isPlainObject } from "lodash";
import ContentDataItem from "./content-data";

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
							<ContentDataItem
								key={key.toString()}
								dataKey={key.toString()}
								dataValue={value}
							/>
						))
					) : (
						<ContentDataItem dataKey={datumValue} />
					)}
				</section>
		  ))
		: objectEntries(dataValue).map(([key, value]) => (
				<ContentDataItem key={key} dataKey={key} dataValue={value} />
		  ));

	return <div className="flex flex-col">{content}</div>;
}
