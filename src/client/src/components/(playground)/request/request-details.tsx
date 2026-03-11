import { useRequest, useRequestNavigation } from "@/components/(playground)/request/request-context";
import Image from "next/image";
import { isArray, isNil, isPlainObject } from "lodash";
import {
	CODE_ITEM_DISPLAY_KEYS,
	ensureTraceRowShape,
	getExtraTabsContentTypes,
	getNormalizedTraceAttribute,
	normalizeTrace,
} from "@/helpers/client/trace";
import { ReverseTraceMapping, TraceMapping } from "@/constants/traces";
import { ExternalLink, X, DollarSign, Zap, Clock, Cpu, ChevronLeft, ChevronRight, BarChart3 } from "lucide-react";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { objectEntries, objectKeys } from "@/utils/object";
import { ValueOf } from "@/types/util";
import { ReactNode, useCallback, useEffect, useState } from "react";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import HeirarchyDisplay from "./heirarchy-display";
import { TraceRow, TransformedTraceRow } from "@/types/trace";
import InfoPill from "./components/info-pill";
import CodeItem from "./components/code-item";
import TabsContentData from "./components/tabs-content";
import ExtraTabs from "./components/extra-tabs";
import ResourceAttributesTab from "./components/resource-attributes-tab";
import SpanAttributesTab from "./components/span-attributes-tab";
import { AttrRow } from "./components/attributes-tab";

// Root-level TraceRow scalar fields that are already shown elsewhere in the UI and
// should NOT be duplicated as info pills.
const REDUNDANT_ROOT_FIELDS = new Set([
	"TraceId",    // shown in header as short trace ID chip
	"SpanName",   // shown in header as the panel title
	"StatusCode", // shown in header as status badge
	"Duration",   // shown in metric card
	"TraceState", // almost always empty
]);

function StatusBadge({ statusCode }: { statusCode?: string }) {
	const isError =
		statusCode === "STATUS_CODE_ERROR" || statusCode === "Error";
	return (
		<span
			className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
				isError
					? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
					: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
			}`}
		>
			<span
				className={`w-1.5 h-1.5 rounded-full ${
					isError ? "bg-red-500" : "bg-green-500"
				}`}
			/>
			{isError ? "Error" : "OK"}
		</span>
	);
}

function MetricCard({
	icon,
	label,
	value,
}: {
	icon: ReactNode;
	label: string;
	value: string | number | undefined;
}) {
	return (
		<div className="flex flex-col gap-1 px-3 py-2 bg-stone-100 dark:bg-stone-800 rounded-lg min-w-[100px] shrink-0">
			<div className="flex items-center gap-1.5 text-stone-500 dark:text-stone-400">
				{icon}
				<span className="text-xs font-medium">{label}</span>
			</div>
			<span className="text-sm font-semibold text-stone-800 dark:text-stone-200 truncate">
				{value ?? "—"}
			</span>
		</div>
	);
}

function LoadingSkeleton() {
	return (
		<div className="flex flex-col gap-4 p-4 animate-pulse">
			{/* Header skeleton */}
			<div className="flex gap-2 items-center">
				<div className="h-5 w-5 rounded-full bg-stone-300 dark:bg-stone-700" />
				<div className="h-4 w-32 rounded bg-stone-300 dark:bg-stone-700" />
				<div className="h-4 w-48 rounded bg-stone-300 dark:bg-stone-700" />
			</div>
			{/* Metrics strip skeleton */}
			<div className="flex gap-2">
				{[1, 2, 3, 4].map((i) => (
					<div
						key={i}
						className="h-14 w-28 rounded-lg bg-stone-300 dark:bg-stone-700"
					/>
				))}
			</div>
			{/* Pills skeleton */}
			<div className="flex flex-wrap gap-2">
				{[1, 2, 3, 4, 5, 6].map((i) => (
					<div
						key={i}
						className="h-7 w-24 rounded bg-stone-300 dark:bg-stone-700"
					/>
				))}
			</div>
		</div>
	);
}

export default function RequestDetails() {
	const [isOpen, setIsOpen] = useState(false);
	const [request, updateRequest] = useRequest();
	const { currentIndex, items, navigatePrev, navigateNext } = useRequestNavigation();
	const { data, fireRequest, isLoading } = useFetchWrapper();

	// Cache the last successfully loaded record so navigation never flickers to a skeleton.
	// While a new fetch is in-flight we keep showing the stale data at reduced opacity.
	const [displayData, setDisplayData] = useState<{
		item: TransformedTraceRow;
		rawRecord: TraceRow;
		evaluationSummary?: { runCount: number; totalCost: number; latestModel?: string };
	} | null>(null);

	const onClose = () => {
		updateRequest(null);
		setIsOpen(false);
		setDisplayData(null);
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
	}, [request?.spanId, fetchData]);

	// Commit successful fetches into the display cache
	useEffect(() => {
		const raw = (data as { record?: TraceRow })?.record;
		const evaluationSummary = (data as { evaluationSummary?: { runCount: number; totalCost: number; latestModel?: string } })?.evaluationSummary;
		const record = raw ? ensureTraceRowShape(raw) : null;
		const hasId = record && ((record as any).TraceId ?? (record as any).trace_id);
		if (record && hasId && !isLoading) {
			setDisplayData({
				item: normalizeTrace(record),
				rawRecord: record,
				evaluationSummary,
			});
		}
	}, [data, isLoading]);

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

	// Show the skeleton only on the very first open (nothing cached yet).
	// On subsequent navigations keep the old content visible while the new fetch runs.
	const isFirstLoad = isLoading && !displayData;
	const isTransitioning = isLoading && !!displayData;

	const normalizedItem: TransformedTraceRow | null = displayData?.item ?? null;
	const rawRecord: TraceRow | null = displayData?.rawRecord ?? null;
	const evaluationSummary = displayData?.evaluationSummary;

	const extraTabs = normalizedItem
		? getExtraTabsContentTypes(normalizedItem)
		: [];
	const tabKeys: string[] = [...extraTabs];
	const reducedData = rawRecord
		? objectEntries(rawRecord || {}).reduce(
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
		  )
		: { arrays: [], objects: [], values: [] };

	// Derived display values for metrics strip
	const parsedCost = parseFloat(normalizedItem?.cost as string);
	const costValue =
		isFinite(parsedCost) && parsedCost > 0
			? `$${parsedCost.toFixed(6)}`
			: undefined;
	const parsedTokens = Number(normalizedItem?.totalTokens);
	const tokensValue =
		isFinite(parsedTokens) && parsedTokens > 0
			? String(parsedTokens)
			: undefined;
	const parsedDuration = parseFloat(normalizedItem?.requestDuration as string);
	const durationValue = isFinite(parsedDuration)
		? `${parsedDuration.toFixed(2)}s`
		: undefined;
	const modelValue =
		normalizedItem?.model && normalizedItem.model !== "-"
			? String(normalizedItem.model)
			: undefined;

	// Trace ID (short display)
	const traceId = rawRecord?.TraceId ?? (rawRecord as any)?.trace_id;
	const shortTraceId = traceId ? `${String(traceId).slice(0, 8)}…` : undefined;

	return (
		<Sheet open={isOpen}>
			<SheetContent
				className="max-w-none sm:max-w-none w-[55%] p-0 gap-0 flex flex-col border-l border-stone-200 dark:border-stone-800 top-2 bottom-2 h-auto focus-visible:outline-none"
				displayOverlay={false}
				displayClose={false}
			>
				<SheetHeader className="flex-row bg-stone-100 dark:bg-stone-900 px-3 py-1.5 items-center space-y-0 gap-2">
					<SheetTitle className="text-stone-900 dark:text-stone-200 text-md font-bold leading-7 capitalize grow pr-1 truncate">
						{!normalizedItem
							? "Loading…"
							: normalizedItem.spanName}
					</SheetTitle>
					{normalizedItem && (
						<>
							<StatusBadge statusCode={normalizedItem.statusCode as string} />
							{shortTraceId && (
								<span className="text-xs text-stone-600 dark:text-stone-400 font-mono bg-stone-200 dark:bg-stone-800 px-1.5 py-0.5 rounded">
									{shortTraceId}
								</span>
							)}
						</>
					)}
					{currentIndex >= 0 && (
						<div className="flex items-center gap-0.5 shrink-0">
							<button
								onClick={navigatePrev}
								disabled={currentIndex <= 0}
								className="p-1 rounded text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
								title="Previous item"
							>
								<ChevronLeft className="h-4 w-4" />
							</button>
							<span className="text-xs text-stone-600 dark:text-stone-500 tabular-nums min-w-[3rem] text-center">
								{currentIndex + 1} / {items.length}
							</span>
							<button
								onClick={navigateNext}
								disabled={currentIndex >= items.length - 1}
								className="p-1 rounded text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
								title="Next item"
							>
								<ChevronRight className="h-4 w-4" />
							</button>
						</div>
					)}
					<X
						className="text-stone-800 dark:text-stone-200 shrink-0 mt-0 space-y-0 cursor-pointer"
						onClick={onClose}
					/>
				</SheetHeader>

				{isFirstLoad ? (
					<LoadingSkeleton />
				) : !normalizedItem ? null : (
					<div
						className={`flex flex-col gap-0 overflow-y-scroll bg-stone-100 dark:bg-stone-900 grow pb-4 transition-opacity duration-200 scrollbar-hidden ${
							isTransitioning ? "opacity-40" : "opacity-100"
						}`}
					>
						{/* Key metrics strip */}
						<div className="shrink-0 flex items-center gap-2 px-4 py-3 overflow-x-auto bg-white dark:bg-stone-950 border-b border-stone-200 dark:border-stone-800">
							<MetricCard
								icon={<DollarSign className="h-3.5 w-3.5" />}
								label="Cost"
								value={costValue}
							/>
							<MetricCard
								icon={<Zap className="h-3.5 w-3.5" />}
								label="Total Tokens"
								value={tokensValue}
							/>
							<MetricCard
								icon={<Clock className="h-3.5 w-3.5" />}
								label="Duration"
								value={durationValue}
							/>
							<MetricCard
								icon={<Cpu className="h-3.5 w-3.5" />}
								label="Model"
								value={modelValue}
							/>
							{evaluationSummary && evaluationSummary.runCount > 0 && (
								<>
									<MetricCard
										icon={<BarChart3 className="h-3.5 w-3.5" />}
										label="Eval Runs"
										value={String(evaluationSummary.runCount)}
									/>
									<MetricCard
										icon={<DollarSign className="h-3.5 w-3.5" />}
										label="Eval Cost"
										value={
											evaluationSummary.totalCost > 0
												? `$${evaluationSummary.totalCost.toFixed(6)}`
												: undefined
										}
									/>
								</>
							)}
						</div>

						{/* Info pills — root-level span metadata (context, correlation IDs, scope) */}
						<div className="shrink-0 flex items-start flex-wrap gap-1 p-4 bg-stone-200 dark:bg-stone-100/[0.15]">
							{reducedData.values
								.filter(([key]) => !REDUNDANT_ROOT_FIELDS.has(key as string))
								.map(([key, value]) => {
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
							{CODE_ITEM_DISPLAY_KEYS.map((key) => {
								const value = normalizedItem[key];
								const mapping = TraceMapping[key];
								const hasValue =
									!isNil(value) &&
									value !== "" &&
									value !== mapping?.defaultValue;
								if (!hasValue) return null;
								const label = mapping?.label ?? key;
								return (
									<AttrRow
										key={key}
										label={label}
										value={value}
										className="bg-stone-50 dark:bg-stone-800/30 flex-col w-full mt-3"
									/>
								);
							})}
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
						</div>

						<Tabs className="" defaultValue={"SpanAttributes"}>
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
							{extraTabs.map((tab) => {
								return (
									<TabsContent value={tab.toString()} key={tab.toString()}>
										<ExtraTabs tabKey={tab} trace={normalizedItem} />
									</TabsContent>
								);
							})}
							{reducedData.objects.map(([key, value]) => {
								return (
									<TabsContent
										value={key.toString()}
										key={key.toString()}
										className="mt-0"
									>
										{
											key === "ResourceAttributes" ? (
												<ResourceAttributesTab resourceAttributes={value as Record<string, any>} />
											) : key === "SpanAttributes" ? (
												<SpanAttributesTab normalizedItem={normalizedItem} spanAttributes={value as Record<string, string | number>} />
											) : (
												<TabsContentData
													dataKey={key}
													dataValue={value as string[] | Record<string, any>[]}
												/>
											)
										}
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
