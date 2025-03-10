import { useRequest } from "./request-context";

import React, { useEffect } from "react";
import { TangentIcon } from "lucide-react";
import {
	findSpanInHierarchyLodash,
	getNormalizedTraceAttribute,
} from "@/helpers/client/trace";
import { TraceHeirarchySpan } from "@/types/trace";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { toast } from "sonner";
import { TraceMapping } from "@/constants/traces";

interface TreeNodeProps {
	span: TraceHeirarchySpan;
	level: number;
}

export function TreeNode({ span, level }: TreeNodeProps) {
	const [request, updateRequest] = useRequest();
	const onClick = () => {
		if (request?.spanId !== span.SpanId) {
			updateRequest({
				spanId: span.SpanId,
			});
		}
		return;
	};

	const spacingParent = level * 20 + 10;

	return (
		<>
			<div
				className={`flex justify-start p-1 font-normal hover:bg-stone-300 dark:hover:bg-stone-800 rounded-xs items-start cursor-pointer relative ${
					request?.spanId === span.SpanId
						? "bg-stone-300 dark:bg-stone-800"
						: ""
				}`}
				onClick={onClick}
				style={{
					paddingLeft: `${spacingParent}px`,
				}}
			>
				{level > 0 && (
					<div
						className="absolute w-[10px] h-[1px] bg-stone-800 dark:bg-stone-300 z-10"
						style={{
							left: `${spacingParent - 15}px`,
							top: "15px",
						}}
					/>
				)}
				<TangentIcon className={`mr-2 h-4 w-4 shrink-0 mt-1`} />
				<div className="flex flex-col grow text-left overflow-hidden">
					<span className="block text-ellipsis overflow-hidden text-sm">
						{span.SpanName}
					</span>
					<span className="text-xs">
						(
						{parseFloat(
							getNormalizedTraceAttribute(
								"requestDuration",
								span.Duration
							) as string
						).toFixed(2)}
						{TraceMapping.requestDuration.valueSuffix})
					</span>
				</div>
			</div>
			{span.children && span.children.length > 0 && (
				<div className="flex flex-col w-full relative">
					<div
						className="absolute w-[1px] h-full bg-stone-800 dark:bg-stone-300 z-10"
						style={{
							left: `${spacingParent + 5}px`,
							top: "-15px",
						}}
					/>
					{span.children.map((child) => (
						<TreeNode key={child.SpanId} span={child} level={level + 1} />
					))}
				</div>
			)}
		</>
	);
}

export default function HeirarchyDisplay() {
	const [request] = useRequest();
	const { data, fireRequest, isLoading } = useFetchWrapper();

	const typedData =
		(data as { record: TraceHeirarchySpan; err?: string }) || {};

	useEffect(() => {
		if (
			!findSpanInHierarchyLodash(typedData.record || {}, request?.spanId) &&
			request?.spanId &&
			!isLoading
		) {
			fireRequest({
				requestType: "GET",
				url: `/api/metrics/request/span/${request?.spanId}/heirarchy`,
				failureCb: (err?: string) => {
					toast.error(err || `Cannot connect to server!`, {
						id: "heirarchy-fetch",
					});
				},
			});
		}
	}, [request, typedData, isLoading]);

	const { record } = typedData;
	if (isLoading || typedData.err || !record) {
		return null;
	}

	return (
		<div className="absolute left-0 -translate-x-full w-2/3 bg-stone-100 dark:bg-stone-900 border border-stone-200 border-t-0 dark:border-stone-900 border-r-0 text-stone-800 dark:text-stone-300 flex flex-col max-h-1/2">
			<p className="flex-row bg-stone-950 px-3 py-2 items-center space-y-0 text-sm font-bold leading-7 text-stone-200">
				Span Heirarchy
			</p>
			<div className="flex flex-col p-2 overflow-y-auto">
				<TreeNode span={record} level={0} />
			</div>
		</div>
	);
}
