import { TransformedTraceRow } from "@/types/trace";
import { noop } from "@/utils/noop";
import { ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

type RequestProps = TransformedTraceRow | null;

type RequestUpdateProps = (value: any) => void | typeof noop;

const RequestContext = createContext<[RequestProps, RequestUpdateProps]>([
	null,
	noop,
]);

type RequestListContextType = {
	items: TransformedTraceRow[];
	currentIndex: number;
	total: number;
	offset: number;
	setItems: (items: TransformedTraceRow[]) => void;
	setTotal: (total: number) => void;
	setOffset: (offset: number) => void;
	setOnPageChange: (cb: ((dir: -1 | 1) => void) | null) => void;
	navigatePrev: () => void;
	navigateNext: () => void;
};

const RequestListContext = createContext<RequestListContextType>({
	items: [],
	currentIndex: -1,
	total: 0,
	offset: 0,
	setItems: noop,
	setTotal: noop,
	setOffset: noop,
	setOnPageChange: noop,
	navigatePrev: noop,
	navigateNext: noop,
});

/**
 * Update URL search params without triggering a full navigation.
 */
function syncUrlParams(request: RequestProps) {
	if (typeof window === "undefined") return;
	const url = new URL(window.location.href);
	if (request?.spanId) {
		url.searchParams.set("spanId", String(request.spanId));
		if (request.id) {
			url.searchParams.set("traceId", String(request.id));
		}
	} else {
		url.searchParams.delete("spanId");
		url.searchParams.delete("traceId");
	}
	window.history.replaceState({}, "", url.toString());
}

export function RequestProvider({ children }: { children: ReactNode }) {
	const [request, setRequest] = useState<RequestProps>(null);
	const [items, setItemsState] = useState<TransformedTraceRow[]>([]);
	const [total, setTotalState] = useState(0);
	const [offset, setOffsetState] = useState(0);

	// Keep refs so navigatePrev/navigateNext always see the latest values
	const requestRef = useRef(request);
	requestRef.current = request;
	const itemsRef = useRef(items);
	itemsRef.current = items;
	const onPageChangeRef = useRef<((dir: -1 | 1) => void) | null>(null);
	const totalRef = useRef(total);
	totalRef.current = total;
	const offsetRef = useRef(offset);
	offsetRef.current = offset;
	// Tracks which direction a page-boundary navigation was triggered so we can
	// auto-select the correct item once the new page's data arrives.
	const pendingNavDirection = useRef<-1 | 1 | null>(null);

	const updateRequest = useCallback((value: RequestProps) => {
		setRequest(value);
		syncUrlParams(value);
	}, []);

	const setItems = useCallback((newItems: TransformedTraceRow[]) => {
		setItemsState(newItems);
		// If a page-boundary navigation triggered the fetch, auto-select the
		// first item (next page) or last item (previous page) of the new data.
		if (pendingNavDirection.current !== null && newItems.length > 0) {
			const target =
				pendingNavDirection.current === 1
					? newItems[0]
					: newItems[newItems.length - 1];
			pendingNavDirection.current = null;
			setRequest(target);
			syncUrlParams(target);
		}
	}, []);

	const setTotal = useCallback((t: number) => {
		setTotalState(t);
	}, []);

	const setOffset = useCallback((o: number) => {
		setOffsetState(o);
	}, []);

	const setOnPageChange = useCallback((cb: ((dir: -1 | 1) => void) | null) => {
		onPageChangeRef.current = cb;
	}, []);

	// On mount, check URL for spanId to restore the open trace
	useEffect(() => {
		if (typeof window === "undefined") return;
		const params = new URLSearchParams(window.location.search);
		const spanId = params.get("spanId");
		const traceId = params.get("traceId");
		if (spanId) {
			// Create a minimal placeholder to trigger the detail sheet fetch
			setRequest({ spanId, id: traceId || "" } as TransformedTraceRow);
		}
	}, []);

	const navigatePrev = useCallback(() => {
		const idx = itemsRef.current.findIndex(
			(item) => item.spanId === requestRef.current?.spanId
		);
		if (idx > 0) {
			const prev = itemsRef.current[idx - 1];
			setRequest(prev);
			syncUrlParams(prev);
		} else if (idx === 0 && offsetRef.current > 0 && onPageChangeRef.current) {
			// At first item of current page — trigger previous page
			pendingNavDirection.current = -1;
			onPageChangeRef.current(-1);
		}
	}, []);

	const navigateNext = useCallback(() => {
		const idx = itemsRef.current.findIndex(
			(item) => item.spanId === requestRef.current?.spanId
		);
		if (idx >= 0 && idx < itemsRef.current.length - 1) {
			const next = itemsRef.current[idx + 1];
			setRequest(next);
			syncUrlParams(next);
		} else if (
			idx === itemsRef.current.length - 1 &&
			offsetRef.current + itemsRef.current.length < totalRef.current &&
			onPageChangeRef.current
		) {
			// At last item of current page — trigger next page
			pendingNavDirection.current = 1;
			onPageChangeRef.current(1);
		}
	}, []);

	const currentIndex =
		request && items.length > 0
			? items.findIndex((item) => item.spanId === request.spanId)
			: -1;

	return (
		<RequestContext.Provider value={[request, updateRequest]}>
			<RequestListContext.Provider
				value={{
					items,
					currentIndex,
					total,
					offset,
					setItems,
					setTotal,
					setOffset,
					setOnPageChange,
					navigatePrev,
					navigateNext,
				}}
			>
				{children}
			</RequestListContext.Provider>
		</RequestContext.Provider>
	);
}

export function useRequest() {
	const context = useContext(RequestContext);
	if (context === undefined) {
		throw new Error("useRequest must be used within a RequestProvider");
	}
	return context;
}

export function useRequestNavigation() {
	return useContext(RequestListContext);
}
