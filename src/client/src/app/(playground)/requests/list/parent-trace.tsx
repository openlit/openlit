import { useCallback, useEffect, useState } from "react";
import { TraceRow } from "@/constants/traces";
import { ScanLine, ScanText } from "lucide-react";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { toast } from "sonner";
import Trace from "./trace";
import RenderLoader from "./loader";

export default function ParentTrace({
	parentSpanId,
}: {
	parentSpanId: string;
}) {
	const [isOpened, setIsOpened] = useState(false);
	const { data, fireRequest, isFetched, isLoading } = useFetchWrapper();
	const fetchData = useCallback(async () => {
		fireRequest({
			requestType: "GET",
			url: `/api/metrics/request/parent-span/${parentSpanId}`,
			responseDataKey: "record.[0]",
			failureCb: (err?: string) => {
				toast.error(err || `Cannot connect to server!`, {
					id: "request-page",
				});
			},
		});
	}, [parentSpanId]);

	const onOpenChange = (open?: boolean) => {
		setIsOpened(!!open);
	};

	useEffect(() => {
		if (isOpened && !isFetched) fetchData();
	}, [isOpened, isFetched]);

	return (
		<Collapsible
			className="py-1 px-4 bg-stone-100 dark:bg-stone-800/[0.6] rounded-b border border-t-0 dark:border-stone-800"
			onOpenChange={onOpenChange}
		>
			<>
				<CollapsibleTrigger className="flex gap-4 w-full items-center py-2 text-stone-500 dark:text-stone-400">
					Parent Span Trace
					{isOpened ? (
						<ScanLine className="w-4" />
					) : (
						<ScanText className="w-4" />
					)}
				</CollapsibleTrigger>
				<CollapsibleContent className="pb-3">
					{!isFetched || isLoading ? (
						<RenderLoader />
					) : !(data as any) && !isLoading ? (
						<div className={`flex w-full items-center text-sm text-stone-500`}>
							No trace for parent exists
						</div>
					) : (
						<Trace
							item={data as any as TraceRow}
							isLoading={isLoading || !isFetched}
						/>
					)}
				</CollapsibleContent>
			</>
		</Collapsible>
	);
}
