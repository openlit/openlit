import { fill } from "lodash";
import IntermediateState from "@/components/(playground)/intermediate-state";
import RenderLoader from "../../../components/(playground)/request/loader";
import Trace from "@/components/(playground)/request/trace";

export default function List({
	data,
	isFetched,
	isLoading,
}: {
	data: any[];
	isFetched: boolean;
	isLoading: boolean;
}) {
	return (
		<div className="flex flex-col flex-1 w-full relative overflow-hidden rounded-md border">
			<div className="grid grid-cols-12 border-b text-stone-800 text-sm bg-stone-200">
				<div className="items-center col-span-1 py-2 px-3">
					TraceId
				</div>
				<div className="items-center col-span-3 py-2 px-3">
					Timestamp
				</div>
				<div className="items-center col-span-2 py-2 px-3">
					Service Name
				</div>
				<div className="items-center col-span-3 py-2 px-3">
					Span Name
				</div>
				<div className="items-center col-span-2 py-2 px-3">
					Duration
				</div>
				<div className="items-center col-span-1 py-2 px-3">
					Actions
				</div>
			</div>
			<div
				className={`flex flex-col w-full h-full text-sm text-left relative overflow-auto ${
					isFetched && isLoading ? "animate-pulse" : ""
				}`}
			>
				{(!isFetched || (isLoading && !data?.length)) &&
					fill(new Array(5), 1).map((_, index) => (
						<RenderLoader key={`item-loader-${index}`} />
					))}
				{data.map((item, index) => (
					<Trace key={`item-${index}`} item={item} isLoading={isLoading} />
				))}
				{!data?.length && !isLoading && <IntermediateState type="nodata" />}
			</div>
		</div>
	);
}
