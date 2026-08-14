"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Maximize2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ResizeablePanel } from "@/components/ui/resizeable-panel";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
	useRequest,
	useRequestNavigation,
} from "@/components/(playground)/request/request-context";
import getMessage from "@/constants/messages";
import { TraceDetailView } from "./trace-detail-page";

const DETAIL_SHEET_CONTENT_CLASS =
	"right-2 top-2 bottom-2 flex h-auto w-auto max-w-none flex-col gap-0 border-0 bg-transparent p-0 shadow-none focus-visible:outline-none sm:max-w-none";

function ResizableTraceDetailSheet({ children }: { children: ReactNode }) {
	const [maxWidth, setMaxWidth] = useState(1200);
	const [defaultWidth, setDefaultWidth] = useState(880);

	useEffect(() => {
		const updateBounds = () => {
			const viewportWidth = window.innerWidth;
			const nextMaxWidth = Math.max(420, viewportWidth - 32);
			setMaxWidth(nextMaxWidth);
			setDefaultWidth(Math.min(Math.max(viewportWidth * 0.72, 900), nextMaxWidth));
		};
		updateBounds();
		window.addEventListener("resize", updateBounds);
		return () => window.removeEventListener("resize", updateBounds);
	}, []);

	return (
		<ResizeablePanel
			defaultWidth={defaultWidth}
			minWidth={420}
			maxWidth={maxWidth}
			handlePosition="left"
			className="h-full max-w-[calc(100vw-1rem)] rounded-md bg-white shadow-2xl dark:bg-stone-950"
			handleClassName="opacity-100 border-stone-300 bg-white dark:border-stone-700 dark:bg-stone-900"
		>
			<div className="flex h-full min-h-0 flex-col overflow-hidden">
				{children}
			</div>
		</ResizeablePanel>
	);
}

export default function TraceDetailRequestSheet() {
	const m = getMessage();
	const router = useRouter();
	const [request, updateRequest] = useRequest();
	const { items, total, offset } = useRequestNavigation();
	const spanId = request?.spanId ? String(request.spanId) : "";
	const [activeSpanId, setActiveSpanId] = useState(spanId);

	useEffect(() => {
		setActiveSpanId(spanId);
	}, [spanId]);

	const closeSheet = () => {
		updateRequest(null);
	};

	const updateSpanSelection = (nextSpanId: string) => {
		setActiveSpanId(nextSpanId);
		updateRequest({
			...(request || {}),
			spanId: nextSpanId,
		});
	};

	const updateActiveSpanSelection = (nextSpanId: string) => {
		setActiveSpanId(nextSpanId);
		if (typeof window === "undefined") return;
		const url = new URL(window.location.href);
		url.searchParams.set("spanId", nextSpanId);
		window.history.replaceState({}, "", url.toString());
	};

	const fullScreenHref = activeSpanId ? `/telemetry/traces/${activeSpanId}` : "";

	return (
		<Sheet
			modal={false}
			open={!!spanId}
			onOpenChange={(open) => !open && closeSheet()}
		>
			<SheetContent
				side="right"
				className={DETAIL_SHEET_CONTENT_CLASS}
				displayOverlay={false}
				displayClose={false}
			>
				<ResizableTraceDetailSheet>
					<div className="min-h-0 flex-1 overflow-hidden">
						{spanId ? (
							<TraceDetailView
								spanId={spanId}
								type="traces"
								variant="sheet"
								onSpanChange={updateSpanSelection}
								onActiveSpanChange={updateActiveSpanSelection}
								navigationRows={items}
								navigationOffset={offset}
								navigationTotal={total}
								extraActions={
									<>
										<Button
											variant="outline"
											size="sm"
											className="h-7 gap-1.5"
											onClick={() => router.push(fullScreenHref)}
											disabled={!fullScreenHref}
										>
											<Maximize2 className="h-3.5 w-3.5" />
											{m.OBSERVABILITY_FULL_SCREEN}
										</Button>
										<Button
											variant="outline"
											size="sm"
											className="h-7 w-7 border-stone-200 bg-white p-0 text-stone-600 hover:bg-stone-100 hover:text-stone-950 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-50"
											onClick={closeSheet}
											title={m.OBSERVABILITY_CLOSE}
										>
											<X className="h-4 w-4" />
										</Button>
									</>
								}
							/>
						) : null}
					</div>
				</ResizableTraceDetailSheet>
			</SheetContent>
		</Sheet>
	);
}
