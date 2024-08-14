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
		<div className="flex flex-col flex-1 w-full relative overflow-hidden">
			<div className="overflow-auto h-full">
				<div
					className={`flex flex-col w-full h-full text-sm text-left relative gap-4 ${
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
		</div>
	);
}
