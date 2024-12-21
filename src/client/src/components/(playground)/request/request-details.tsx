import { useRequest } from "@/components/(playground)/request/request-context";
import Image from "next/image";
import { isArray, isNil, isPlainObject } from "lodash";
import {
	CODE_ITEM_DISPLAY_KEYS,
	getNormalizedTraceAttribute,
	normalizeTrace,
} from "@/helpers/trace";
import {
	ReverseTraceMapping,
	TraceMapping,
	TraceRow,
	TransformedTraceRow,
} from "@/constants/traces";
import { ExternalLink } from "lucide-react";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { objectEntries } from "@/utils/object";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { ValueOf } from "@/utils/types";
import JsonViewer from "@/components/common/json-viewer";
import { useCallback, useEffect, useState } from "react";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { toast } from "sonner";

const InfoPill = ({ title, value }: { title: string; value: any }) => {
	return (
		<Button
			variant="outline"
			size="default"
			className="text-stone-500 bg-stone-300 dark:text-stone-300 dark:bg-stone-800 cursor-default h-8"
		>
			<span className="text-xs bg-transparent">{title}</span>
			<Separator
				orientation="vertical"
				className="mx-2 h-4 bg-stone-300 dark:bg-stone-600"
			/>
			<Badge
				variant="secondary"
				className="rounded-sm px-1 font-normal bg-transparent py-0"
			>
				{value}
			</Badge>
		</Button>
	);
};

const CodeItem = ({ label, text }: { label: string; text: string }) => (
	<div className="flex flex-col space-y-3 mt-4 group">
		<span className="text-sm text-stone-500 font-medium dark:text-stone-300">
			{label} :{" "}
		</span>
		<code className="text-sm inline-flex text-left items-center bg-stone-300 text-stone-700 rounded-md p-4 group-hover:text-stone-900 cursor-pointer dark:bg-stone-800 dark:text-stone-200 dark:group-hover:text-stone-100">
			<JsonViewer value={text} />
		</code>
	</div>
);

const AccordionDataItem = ({
	dataKey,
	dataValue,
}: {
	dataKey: string;
	dataValue?: string;
}) => (
	<div
		className={`grid ${
			dataValue ? "grid-cols-2" : ""
		} p-2 border border-stone-300 border-b-0 last:border-b hover:bg-stone-300/[0.5] group cursor-pointer dark:bg-stone-700 dark:border-stone-800 dark:last:border-stone-800`}
	>
		<div className="break-all pr-2 text-stone-500 dark:text-stone-300">
			{dataKey}
		</div>
		{!(isNil(dataValue) || dataValue === "") && (
			<div className="break-all pl-2 group-hover:text-stone-950  dark:group-hover:text-stone-100">
				<JsonViewer value={dataValue} />
			</div>
		)}
	</div>
);

const AccordionData = ({
	dataKey,
	dataValue,
}: {
	dataKey: string;
	dataValue: Record<string, any> | string[] | Record<string, any>[];
}) => {
	return (
		<Accordion
			type="single"
			collapsible
			defaultValue={dataKey}
			className="mt-4"
		>
			<AccordionItem value={dataKey} className="border-b-0">
				<AccordionTrigger className="bg-stone-300 p-2 text-stone-500 dark:bg-stone-800 dark:text-stone-200">
					{dataKey} {isArray(dataValue) ? "[]" : ""}
				</AccordionTrigger>
				<AccordionContent className="pb-0">
					{isArray(dataValue)
						? dataValue.map((datumValue, index) => (
								<section key={`${dataKey}-${index}`}>
									{index !== 0 ? (
										<div className="py-1 px-2 dark:bg-stone-800"></div>
									) : null}
									{isPlainObject(datumValue) ? (
										objectEntries(datumValue).map(([key, value]) => (
											<AccordionDataItem
												key={key.toString()}
												dataKey={key.toString()}
												dataValue={value}
											/>
										))
									) : (
										<AccordionDataItem dataKey={datumValue} />
									)}
								</section>
						  ))
						: objectEntries(dataValue).map(([key, value]) => (
								<AccordionDataItem key={key} dataKey={key} dataValue={value} />
						  ))}
				</AccordionContent>
			</AccordionItem>
		</Accordion>
	);
};

export default function RequestDetails() {
	const [isOpen, setIsOpen] = useState(false);
	const [request, updateRequest] = useRequest();
	const { data, fireRequest, isLoading } = useFetchWrapper();

	const onClose = (open: boolean) => {
		if (!open) {
			updateRequest(null);
			setIsOpen(false);
		}
	};

	const fetchData = useCallback(async () => {
		setIsOpen(true);
		fireRequest({
			requestType: "GET",
			url: `/api/metrics/request/trace/${request?.id}`,
			failureCb: (err?: string) => {
				toast.error(err || `Cannot connect to server!`, {
					id: "request-page",
				});
			},
		});
	}, [request]);

	useEffect(() => {
		if (request?.id) fetchData();
	}, [fetchData, request]);

	// if (!request) return null;

	const isFetchingData =
		!(data as { record?: TraceRow })?.record?.TraceId || isLoading;

	const normalizedItem: TransformedTraceRow | null = isFetchingData
		? null
		: normalizeTrace((data as { record: TraceRow }).record);

	const reducedData = isFetchingData
		? { arrays: [], objects: [], values: [] }
		: objectEntries((data as { record: TraceRow }).record || {}).reduce(
				(
					acc: {
						arrays: [keyof TraceRow, ValueOf<TraceRow>][];
						objects: [keyof TraceRow, ValueOf<TraceRow>][];
						values: [keyof TraceRow, ValueOf<TraceRow>][];
					},
					[key, value]
				) => {
					if (isPlainObject(value)) {
						acc.objects.push([key, value]);
					} else if (isArray(value)) {
						acc.arrays.push([key, value]);
					} else {
						acc.values.push([key, value]);
					}

					return acc;
				},
				{ arrays: [], objects: [], values: [] }
		  );

	return (
		<Sheet open={isOpen} onOpenChange={onClose}>
			<SheetContent className="max-w-none sm:max-w-none w-1/2 bg-stone-200 dark:bg-stone-500 p-0 border-none grid gap-0">
				<SheetHeader className="bg-stone-950 px-4 py-3">
					<SheetTitle>
						<div className="flex flex-col text-stone-200">
							<div className="flex items-center text-2xl font-bold leading-7">
								<p className="capitalize">
									{isFetchingData || !normalizedItem
										? "..."
										: normalizedItem.spanName}
								</p>
							</div>
						</div>
					</SheetTitle>
				</SheetHeader>
				{isFetchingData || !normalizedItem ? (
					"Loading!!!"
				) : (
					<div className="flex flex-col gap-3 overflow-y-scroll p-4">
						<div className="flex items-start flex-wrap gap-3">
							{reducedData.values.map(([key, value]) => {
								const reverseKey = ReverseTraceMapping[key];
								const normalizedValue = `${
									reverseKey ? TraceMapping[reverseKey].valuePrefix || "" : ""
								}${
									reverseKey
										? getNormalizedTraceAttribute(reverseKey, value)
										: value
								}${
									reverseKey ? TraceMapping[reverseKey].valueSuffix || "" : ""
								}`;
								return (
									!isNil(value) &&
									value.toString().length > 0 && (
										<InfoPill
											key={key}
											title={reverseKey ? TraceMapping[reverseKey].label : key}
											value={normalizedValue}
										/>
									)
								);
							})}
						</div>

						{CODE_ITEM_DISPLAY_KEYS.map(
							(key) =>
								normalizedItem[key] && (
									<CodeItem
										key={key}
										label={TraceMapping[key].label}
										text={normalizedItem[key]}
									/>
								)
						)}

						{/* Image */}
						{normalizedItem.image && normalizedItem.imageSize && (
							<a
								href={normalizedItem.image}
								target="_blank"
								rel="noopener noreferrer"
								className="flex items-center justify-center aspect-h-1 aspect-w-1 w-full overflow-hidden rounded-md bg-stone-100 lg:aspect-none lg:h-80 mt-4 group relative p-4 text-center text-stone-500"
							>
								<Image
									src={normalizedItem.image}
									alt={normalizedItem.applicationName}
									className="h-full w-full object-cover object-center lg:h-full lg:w-full"
									width={parseInt(normalizedItem.imageSize.split("x")[0], 10)}
									height={parseInt(normalizedItem.imageSize.split("x")[1], 10)}
								/>
								<span className="flex items-center justify-center opacity-0 group-hover:opacity-100 absolute top-0 left-0 w-full h-full text-primary bg-stone-100/[0.1]">
									<ExternalLink className="w-6 h-6 ml-2 shrink-0" />
								</span>
							</a>
						)}
						{/* Image */}

						{reducedData.objects.map(([key, value]) => {
							return (
								<AccordionData
									key={key.toString()}
									dataKey={key}
									dataValue={value as Record<string, any>}
								/>
							);
						})}

						{reducedData.arrays.map(([key, value]) =>
							(value as unknown[]).length > 0 ? (
								<AccordionData
									key={key.toString()}
									dataKey={key}
									dataValue={value as string[] | Record<string, any>[]}
								/>
							) : null
						)}
					</div>
				)}
			</SheetContent>
		</Sheet>
	);
}
