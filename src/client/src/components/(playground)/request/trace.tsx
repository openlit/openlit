import { format } from "date-fns";
import { isNil, round } from "lodash";
import { useRequest } from "@/components/(playground)/request/request-context";
import { ReactNode } from "react";
import {
	getDisplayKeysForException,
	getRequestTableDisplayKeys,
	normalizeTrace,
} from "@/helpers/trace";
import {
	TraceMapping,
	TraceRow,
	TransformedTraceRow,
} from "@/constants/traces";
import { CalendarDays, Clock, SquareTerminal } from "lucide-react";
import ParentTrace from "./parent-trace";
import { Badge } from "@/components/ui/badge";

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
			className={`flex ${containerClass} shrink-0 flex-1 relative h-full items-center p-2 gap-2 overflow-hidden`}
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

export default function Trace({ item, isLoading }: RenderRowProps) {
	const [request, updateRequest] = useRequest();

	const onClick = () => !isLoading && updateRequest(item);

	const normalizedItem: TransformedTraceRow = normalizeTrace(item);
	const isException = normalizedItem.statusCode === "STATUS_CODE_ERROR";
	const requestDisplayItems = isException
		? getDisplayKeysForException()
		: getRequestTableDisplayKeys(normalizedItem.type);

	const date = new Date(`${normalizedItem.time}Z`);
	const ServiceIcon = TraceMapping.serviceName.icon;
	const SpanIcon = TraceMapping.spanName.icon;

	return (
		<div
			className={`grid grid-cols-12 border-b items-center cursor-pointer text-stone-500 hover:text-stone-700 group ${
				request?.TraceId === normalizedItem.id
					? "bg-stone-200 dark:bg-stone-950"
					: ""
			}`}
			onClick={onClick}
		>
			<div className="py-2 px-3 col-span-1">
				<Badge
					variant="outline"
					className="rounded-md text-stone-500 group-hover:text-stone-700"
				>
					...{normalizedItem.id.substring(normalizedItem.id.length - 6)}
				</Badge>
			</div>
			<div className="flex space-x-2 py-2 px-3 col-span-3">
				<CalendarDays size="16" />
				<span className="max-w-[500px] truncate font-medium">
					{format(date, "MMM do, y  HH:mm:ss a")}
				</span>
			</div>
			<div className="flex space-x-2 py-2 px-3 col-span-2">
				{ServiceIcon && <ServiceIcon size="16" />}
				<span className="max-w-[500px] truncate font-medium">
					{normalizedItem.serviceName}
				</span>
			</div>
			<div className="flex space-x-2 py-2 px-3 col-span-3">
				{SpanIcon && <SpanIcon size="16" />}
				<span className="max-w-[500px] truncate font-medium">
					{normalizedItem.spanName}
				</span>
			</div>
			<div className="space-x-2 py-2 px-3 col-span-2 items-center">
				<Badge
					variant="outline"
					className="rounded-md text-stone-500 group-hover:text-stone-700"
				>
					{normalizedItem.statusCode.replace("STATUS_CODE_", "")}
				</Badge>
				<span className="max-w-[500px] truncate font-medium">
					{round(normalizedItem.requestDuration, 4)}s
				</span>
			</div>
			<div className="items-center py-2 px-3 col-span-1">Actions</div>
		</div>
	);

	return (
		<div className="flex flex-col">
			<div className="flex w-full justify-between">
				<div className="flex items-center rounded-t py-1 px-3 z-0 self-start bg-stone-200 dark:bg-stone-800 text-stone-500 dark:text-stone-400 font-medium">
					<div className="flex items-center pr-3">
						<CalendarDays size="16" />
						<p className="text-xs leading-none ml-2">
							{format(date, "MMM do, y  HH:mm:ss a")}
						</p>
					</div>
					<div className="flex items-center pl-3 border-l border-stone-200">
						<Clock size="16" />
						<p className="text-xs leading-none ml-2">
							{round(normalizedItem.requestDuration, 4)}s
						</p>
					</div>
				</div>
				<div className="flex items-center rounded-t py-1 px-3 z-0 self-end bg-stone-200 dark:bg-stone-800 text-stone-500 dark:text-stone-400 font-medium">
					<div className="flex items-center pr-3">
						<SquareTerminal size="16" />
						<p className="text-xs leading-none ml-2">
							{normalizedItem.statusCode}
						</p>
					</div>
				</div>
			</div>
			<div
				className={`flex items-stretch h-16 relative items-center px-3 cursor-pointer  dark:text-stone-100 text-stone-950 ${
					request?.TraceId === normalizedItem.id
						? "bg-stone-200 dark:bg-stone-950"
						: "border border-stone-200 dark:border-stone-800"
				} ${normalizedItem.parentSpanId ? "rounded-b-0" : "rounded-b"}`}
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
			{normalizedItem.parentSpanId ? (
				<ParentTrace parentSpanId={normalizedItem.parentSpanId} />
			) : null}
		</div>
	);
}
