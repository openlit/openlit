import { format } from "date-fns";
import { fill, isNil, round } from "lodash";
import { useRequest } from "./request-context";
import { ReactNode } from "react";
import { getRequestTableDisplayKeys, normalizeTrace } from "@/helpers/trace";
import {
	TraceMapping,
	TraceRow,
	TransformedTraceRow,
} from "@/constants/traces";
import { CalendarDays, Clock } from "lucide-react";
import IntermediateState from "@/components/(playground)/intermediate-state";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";

type RenderRowProps = {
	item: TraceRow;
	isLoading?: boolean;
};

const RowItem = ({
	containerClass = "",
	icon,
	label,
	text,
	textClass = "",
}: {
	containerClass?: string;
	icon?: ReactNode;
	label: string;
	text: string;
	textClass?: string;
}) => {
	return (
		<div
			className={`flex ${containerClass} shrink-0 flex-1 relative h-full justify-center items-center p-2 space-x-2`}
		>
			{icon && (
				<div className="flex self-start" style={{ marginTop: "2px" }}>
					{icon}
				</div>
			)}
			<div className="flex flex-col w-full justify-center space-y-1">
				<span
					className={`leading-none text-ellipsis pb-2 overflow-hidden whitespace-nowrap ${textClass}`}
				>
					{text}
				</span>
				<span className="text-xs text-ellipsis overflow-hidden whitespace-nowrap text-stone-500 dark:text-stone-500">
					{label}
				</span>
			</div>
		</div>
	);
};

const RenderRow = ({ item, isLoading }: RenderRowProps) => {
	const [request, updateRequest] = useRequest();

	const onClick = () => !isLoading && updateRequest(item);

	const normalizedItem: TransformedTraceRow = normalizeTrace(item);
	const requestDisplayItems = getRequestTableDisplayKeys(normalizedItem.type);

	return (
		<div className="flex flex-col">
			<div className="flex items-center rounded-t py-1 px-3 z-0 self-start bg-stone-200 dark:bg-stone-800 text-stone-500 dark:text-stone-400 font-medium">
				<div className="flex items-center pr-3">
					<CalendarDays size="16" />
					<p className="text-xs leading-none ml-2">
						{format(normalizedItem.time, "MMM do, y  HH:mm:ss a")}
					</p>
				</div>
				<div className="flex items-center pl-3 border-l border-stone-200">
					<Clock size="16" />
					<p className="text-xs leading-none ml-2">
						{round(normalizedItem.requestDuration, 4)}s
					</p>
				</div>
			</div>
			<div
				className={`flex items-stretch h-16 relative items-center px-3 cursor-pointer  dark:text-stone-100 text-stone-950 ${
					request?.TraceId === normalizedItem.id
						? "bg-stone-200 dark:bg-stone-950"
						: "border border-stone-200 dark:border-stone-800"
				} ${normalizedItem.ParentSpanId ? "" : "rounded-b"}`}
				onClick={onClick}
			>
				{requestDisplayItems.map((keyItem, index) => {
					if (!keyItem || isNil(normalizedItem[keyItem]))
						return (
							<RowItem
								key={`empty-${index}`}
								containerClass={index <= 1 ? "w-3/12" : "w-1.5/12"}
								label={""}
								text={""}
								textClass={index === 0 ? "font-medium" : "text-sm"}
							/>
						);
					const IconElement = TraceMapping[keyItem].icon;
					return (
						<RowItem
							key={`${keyItem}-${index}`}
							containerClass={index <= 1 ? "w-3/12" : "w-1.5/12"}
							label={TraceMapping[keyItem].label}
							text={normalizedItem[keyItem]}
							icon={IconElement && <IconElement size="16" />}
							textClass={index === 0 ? "font-medium" : "text-sm"}
						/>
					);
				})}
			</div>
			{!normalizedItem.ParentSpanId ? (
				<Collapsible className="py-1 px-4 bg-stone-100 dark:bg-stone-800 rounded-b">
					<>
						<CollapsibleTrigger className="flex w-full items-center">Parent</CollapsibleTrigger>
						<CollapsibleContent>Hello</CollapsibleContent>
					</>
				</Collapsible>
			) : null}
		</div>
	);
};

const RowItemLoader = ({
	icon = false,
	text = true,
	width = "",
}: {
	icon?: boolean;
	text?: boolean;
	width?: string;
}) => (
	<div
		className={`flex ${width} flex-1 shrink-0 relative h-full justify-center items-center py-4 px-2`}
	>
		{icon && (
			<div className="h-3 w-3 mr-3 rounded-full bg-secondary/[0.9] rounded self-start shrink-0" />
		)}
		{text && (
			<div className="flex flex-col w-full justify-center space-y-3">
				<div className="h-1 w-24 bg-secondary/[0.9] rounded" />
				<div className="h-1 w-16 bg-secondary/[0.9] rounded" />
			</div>
		)}
	</div>
);

const RenderRowLoader = () => {
	return (
		<div className="flex flex-col mb-4 animate-pulse">
			<div className="flex items-center rounded-t py-1.5 px-3 z-0 self-start bg-secondary text-primary font-medium">
				<div className="flex items-center pr-3">
					<div className="h-3 w-3 mr-2 rounded-full bg-secondary/[0.9] rounded" />
					<div className="h-1 w-40 bg-secondary/[0.9] rounded" />
				</div>
				<div className="flex items-center pl-3 border-l border-stone-200">
					<div className="h-3 w-3 mr-2 rounded-full bg-secondary/[0.9] rounded" />
					<div className="h-1 w-14 bg-secondary/[0.9] rounded" />
				</div>
			</div>
			<div className="flex items-stretch h-16 border border-secondary relative items-center px-3 rounded-b">
				<RowItemLoader width="w-3/12" />
				<RowItemLoader icon width="w-3/12" />
				<RowItemLoader icon width="w-1.5/12" />
				<RowItemLoader icon width="w-1.5/12" />
				<RowItemLoader icon width="w-1.5/12" />
				<RowItemLoader icon width="w-1.5/12" />
			</div>
		</div>
	);
};

const NoDataBoundary = () => <IntermediateState type="nodata" />;

export default function RequestTable({
	data,
	isFetched,
	isLoading,
}: {
	data: any[];
	isFetched: boolean;
	isLoading: boolean;
}) {
	return (
		<div className="flex flex-col flex-1 w-full relative overflow-hidden">
			<div className="overflow-auto h-full">
				<div
					className={`flex flex-col w-full h-full text-sm text-left relative gap-4 ${
						isFetched && isLoading ? "animate-pulse" : ""
					}`}
				>
					{(!isFetched || (isLoading && !data?.length)) &&
						fill(new Array(5), 1).map((_, index) => (
							<RenderRowLoader key={`item-loader-${index}`} />
						))}
					{data.map((item, index) => (
						<RenderRow
							key={`item-${index}`}
							item={item}
							isLoading={isLoading}
						/>
					))}
					{!data?.length && !isLoading && <NoDataBoundary />}
				</div>
			</div>
		</div>
	);
}
