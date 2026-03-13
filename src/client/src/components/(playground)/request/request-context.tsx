import { TransformedTraceRow } from "@/types/trace";
import { noop } from "@/utils/noop";
import { ReactNode, createContext, useCallback, useContext, useRef, useState } from "react";

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
	}, []);

	const setItems = useCallback((newItems: TransformedTraceRow[]) => {
		setItemsState(newItems);
	}, []);

	const navigatePrev = useCallback(() => {
		const idx = itemsRef.current.findIndex(
			(item) => item.spanId === requestRef.current?.spanId
		);
		if (idx > 0) {
			setRequest(itemsRef.current[idx - 1]);
		}
	}, []);

	const navigateNext = useCallback(() => {
		const idx = itemsRef.current.findIndex(
			(item) => item.spanId === requestRef.current?.spanId
		);
		if (idx >= 0 && idx < itemsRef.current.length - 1) {
			setRequest(itemsRef.current[idx + 1]);
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
