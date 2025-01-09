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
import { ExternalLink, X } from "lucide-react";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { objectEntries, objectKeys } from "@/utils/object";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { ValueOf } from "@/utils/types";
import JsonViewer from "@/components/common/json-viewer";
import { useCallback, useEffect, useState } from "react";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import HeirarchyDisplay from "./heirarchy-display";

const InfoPill = ({ title, value }: { title: string; value: any }) => {
	return (
		<Button
			variant="outline"
			size="default"
			className="text-stone-500 bg-stone-300 dark:text-stone-300 dark:bg-stone-800 cursor-default px-2 py-1 h-auto overflow-hidden"
		>
			<span className="text-xs bg-transparent">{title}</span>
			<Separator
				orientation="vertical"
				className="mx-1 h-4 bg-stone-300 dark:bg-stone-600"
			/>
			<Badge
				variant="secondary"
				className="rounded-sm px-1 font-normal bg-transparent py-0 block ellipsis overflow-hidden whitespace-normal"
			>
				{value}
			</Badge>
		</Button>
	);
};

const CodeItem = ({ label, text }: { label: string; text: string }) => (
	<div className="flex flex-col space-y-3 mt-4 group p-4 w-full">
		<span className="text-sm text-stone-500 font-medium dark:text-stone-300">
			{label} :
		</span>
		<code className="text-sm inline-flex text-left items-center bg-stone-300 text-stone-700 rounded-md p-4 group-hover:text-stone-900 cursor-pointer dark:bg-stone-800 dark:text-stone-200 dark:group-hover:text-stone-100">
			<JsonViewer value={text} />
		</code>
	</div>
);

const ContentDataItem = ({
	dataKey,
	dataValue,
}: {
	dataKey: string;
	dataValue?: string;
}) => (
	<div
		className={`grid ${
			dataValue ? "grid-cols-2" : ""
		} px-4 py-2 group cursor-pointer dark:bg-stone-700 dark:border-stone-800 dark:last:border-stone-800 odd:bg-stone-200/[0.4] even:bg-stone-200/[0.8] dark:odd:bg-stone-700/[0.4] dark:even:bg-stone-700/[0.8]`}
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

const TabsContentData = ({
	dataKey,
	dataValue,
}: {
	dataKey: string;
	dataValue: Record<string, any> | string[] | Record<string, any>[];
}) => {
	return isArray(dataValue)
		? dataValue.map((datumValue, index) => (
				<section key={`${dataKey}-${index}`}>
					{index !== 0 ? (
						<div className="py-1 px-2 dark:bg-stone-800"></div>
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
};

export default function RequestDetails() {
	const [isOpen, setIsOpen] = useState(false);
	const [request, updateRequest] = useRequest();
	const { data, fireRequest, isLoading } = useFetchWrapper();

	const onClose = () => {
		updateRequest(null);
		setIsOpen(false);
	};

	const fetchData = useCallback(async () => {
		setIsOpen(true);
		fireRequest({
			requestType: "GET",
			url: `/api/metrics/request/span/${request?.spanId}`,
			failureCb: (err?: string) => {
				toast.error(err || `Cannot connect to server!`, {
					id: "request-page",
				});
			},
		});
	}, [request]);

	useEffect(() => {
		if (request?.spanId) {
			fetchData();
		}
	}, [fetchData, request]);

	useEffect(() => {
		if (isOpen) {
			// Pushing the change to the end of the call stack
			const timer = setTimeout(() => {
				document.body.style.pointerEvents = "";
			}, 0);

			return () => clearTimeout(timer);
		} else {
			document.body.style.pointerEvents = "auto";
		}
	}, [isOpen]);

	const isFetchingData =
		!(data as { record?: TraceRow })?.record?.TraceId || isLoading;

	const normalizedItem: TransformedTraceRow | null = isFetchingData
		? null
		: normalizeTrace((data as { record: TraceRow }).record);

	const tabKeys: string[] = [];
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
						if (objectKeys(value as object).length > 0) {
							acc.objects.push([key, value]);
							tabKeys.push(key);
						}
					} else if (isArray(value)) {
						if (value.length > 0) {
							acc.arrays.push([key, value]);
							tabKeys.push(key);
						}
					} else {
						acc.values.push([key, value]);
					}

					return acc;
				},
				{ arrays: [], objects: [], values: [] }
		  );

	return (
		<Sheet open={isOpen}>
			<SheetContent
				className="max-w-none sm:max-w-none w-2/5 p-0 gap-0 flex flex-col border-l border-stone-200 dark:border-stone-800 top-[57px] h-auto"
				displayOverlay={false}
				displayClose={false}
			>
				<SheetHeader className="flex-row bg-stone-950 px-4 py-3 items-center space-y-0">
					<SheetTitle className="text-stone-200 text-2xl font-bold leading-7 capitalize grow pr-3">
						{isFetchingData || !normalizedItem
							? "..."
							: normalizedItem.spanName}
					</SheetTitle>
					<X
						className="text-stone-200 shrink-0 mt-0 space-y-0 cursor-pointer"
						onClick={onClose}
					/>
				</SheetHeader>
				{isFetchingData || !normalizedItem ? (
					<div className="flex flex-col items-center justify-center h-full text-3xl">
						...
					</div>
				) : (
					<div className="flex flex-col gap-0 overflow-y-scroll bg-stone-100 dark:bg-stone-900 grow pb-4">
						<div className="flex items-start flex-wrap gap-1 p-4 bg-stone-200 dark:bg-stone-100/[0.15]">
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
									className="flex items-center justify-center aspect-h-1 aspect-w-1 w-full overflow-hidden rounded-md bg-stone-100 lg:aspect-none lg:h-80 mt-4 group relative p-4 text-center text-stone-500 shrink-0"
								>
									<Image
										src={normalizedItem.image}
										alt={normalizedItem.applicationName}
										className="h-full w-full object-cover object-center lg:h-full lg:w-full"
										width={parseInt(normalizedItem.imageSize.split("x")[0], 10)}
										height={parseInt(
											normalizedItem.imageSize.split("x")[1],
											10
										)}
									/>
									<span className="flex items-center justify-center opacity-0 group-hover:opacity-100 absolute top-0 left-0 w-full h-full text-primary bg-stone-100/[0.1]">
										<ExternalLink className="w-6 h-6 ml-2 shrink-0" />
									</span>
								</a>
							)}
							{/* Image */}
						</div>

						<Tabs className="" defaultValue={tabKeys[0].toString()}>
							<TabsList className="h-auto flex overflow-auto justify-start w-full rounded-none pt-2 bg-transparent dark:bg-transparent px-0">
								{tabKeys.map((key) => {
									return (
										<TabsTrigger
											value={key.toString()}
											key={key.toString()}
											className="data-[state=active]:bg-transparent dark:data-[state=active]:bg-transparent data-[state=active]:text-primary dark:data-[state=active]:text-primary data-[state=active]:border-primary dark:data-[state=active]:border-primary border-b border-transparent data-[state=active]:shadow-none rounded-none px-4"
										>
											{key}
										</TabsTrigger>
									);
								})}
							</TabsList>
							{reducedData.objects.map(([key, value]) => {
								return (
									<TabsContent
										value={key.toString()}
										key={key.toString()}
										className="mt-0"
									>
										<TabsContentData
											dataKey={key}
											dataValue={value as Record<string, any>}
										/>
									</TabsContent>
								);
							})}
							{reducedData.arrays.map(([key, value]) => {
								return (
									<TabsContent
										value={key.toString()}
										key={key.toString()}
										className="mt-0"
									>
										<TabsContentData
											dataKey={key}
											dataValue={value as string[] | Record<string, any>[]}
										/>
									</TabsContent>
								);
							})}
						</Tabs>
					</div>
				)}
				<HeirarchyDisplay />
			</SheetContent>
		</Sheet>
	);
}
