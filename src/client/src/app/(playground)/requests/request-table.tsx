import {
	BeakerIcon,
	CalendarDaysIcon,
	ClipboardDocumentCheckIcon,
	ClipboardDocumentListIcon,
	ClockIcon,
	CogIcon,
	CurrencyDollarIcon,
} from "@heroicons/react/24/outline";
import { format } from "date-fns";
import { fill, round } from "lodash";
import { DisplayDataRequestMappingKeys, useRequest } from "./request-context";
import { ReactNode } from "react";

type RenderRowProps = {
	item: Record<(typeof DisplayDataRequestMappingKeys)[number], any>;
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
			{icon && <div className="flex self-start mt-2">{icon}</div>}
			<div className="flex flex-col w-full justify-center space-y-1">
				<span
					className={`leading-none text-ellipsis py-2 overflow-hidden whitespace-nowrap ${textClass}`}
				>
					{text}
				</span>
				<span className="text-xs text-ellipsis overflow-hidden whitespace-nowrap  text-tertiary/[0.4]">
					{label}
				</span>
			</div>
		</div>
	);
};

const RenderRow = ({ item, isLoading }: RenderRowProps) => {
	const [request, updateRequest] = useRequest();

	const onClick = () => !isLoading && updateRequest(item);

	return (
		<div className="flex flex-col mb-4">
			<div className="flex items-center rounded-t py-1 px-3 z-0 self-start bg-secondary text-primary font-medium">
				<div className="flex items-center pr-3">
					<CalendarDaysIcon className="w-4" />
					<p className="text-xs leading-none ml-2">
						{format(item.time, "MMM do, y  HH:mm:ss a")}
					</p>
				</div>
				<div className="flex items-center pl-3 border-l border-tertiary/[0.2]">
					<ClockIcon className="w-4" />
					<p className="text-xs leading-none ml-2">
						{round(item.requestDuration, 4)}s
					</p>
				</div>
			</div>
			<div
				className={`flex items-stretch h-16 border border-secondary relative items-center px-3 rounded-b cursor-pointer ${
					request?.id === item.id && "bg-secondary/[0.7]"
				}`}
				onClick={onClick}
			>
				<RowItem
					containerClass="w-3/12"
					label="App name"
					text={item.applicationName}
					textClass="font-medium"
				/>
				<RowItem
					containerClass="w-3/12"
					icon={<BeakerIcon className="w-4" />}
					label="LLM client"
					text={item.endpoint}
					textClass="text-sm"
				/>
				<RowItem
					containerClass="w-1.5/12"
					icon={<CogIcon className="w-4" />}
					label="Model"
					text={item.model}
					textClass="text-sm"
				/>
				<RowItem
					containerClass="w-1.5/12"
					icon={<CurrencyDollarIcon className="w-4" />}
					label="Usage cost"
					text={`${round(item.usageCost, 6)}`}
					textClass="text-sm"
				/>
				<RowItem
					containerClass="w-1.5/12"
					icon={<ClipboardDocumentCheckIcon className="w-4" />}
					label="Prompt Tokens"
					text={`${item.promptTokens || "-"}`}
					textClass="text-sm"
				/>
				<RowItem
					containerClass="w-1.5/12"
					icon={<ClipboardDocumentListIcon className="w-4" />}
					label="Total Tokens"
					text={`${item.totalTokens || "-"}`}
					textClass="text-sm"
				/>
			</div>
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
				<div className="flex items-center pl-3 border-l border-tertiary/[0.2]">
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

const NoDataBoundary = () => (
	<div className="border border-secondary flex h-full items-center p-4 justify-center text-tertiary/[0.5]">
		No data available
	</div>
);

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
		<div className="flex flex-col flex-1 p-2 w-full relative sm:rounded-lg overflow-hidden mt-3">
			<div className="overflow-auto h-full">
				<div
					className={`flex flex-col w-full h-full text-sm text-left relative ${
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
