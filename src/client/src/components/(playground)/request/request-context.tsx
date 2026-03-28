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
	setItems: (items: TransformedTraceRow[]) => void;
	navigatePrev: () => void;
	navigateNext: () => void;
};

const RequestListContext = createContext<RequestListContextType>({
	items: [],
	currentIndex: -1,
	setItems: noop,
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

	// Keep refs so navigatePrev/navigateNext always see the latest values
	const requestRef = useRef(request);
	requestRef.current = request;
	const itemsRef = useRef(items);
	itemsRef.current = items;

	const updateRequest = useCallback((value: RequestProps) => {
		setRequest(value);
		syncUrlParams(value);
	}, []);

	const setItems = useCallback((newItems: TransformedTraceRow[]) => {
		setItemsState(newItems);
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
		}
	}, []);

	const currentIndex =
		request && items.length > 0
			? items.findIndex((item) => item.spanId === request.spanId)
			: -1;

	return (
		<RequestContext.Provider value={[request, updateRequest]}>
			<RequestListContext.Provider
				value={{ items, currentIndex, setItems, navigatePrev, navigateNext }}
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
