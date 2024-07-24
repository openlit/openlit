import { TraceRow } from "@/constants/traces";
import { noop } from "@/utils/noop";
import { ReactNode, createContext, useContext, useState } from "react";

type RequestProps = TraceRow | null;

type RequestUpdateProps = (value: any) => void | typeof noop;

const RequestContext = createContext<[RequestProps, RequestUpdateProps]>([
	null,
	noop,
]);

export function RequestProvider({ children }: { children: ReactNode }) {
	const [request, setRequest] = useState<RequestProps>(null);
	const updateRequest = (value: RequestProps) => {
		setRequest(value);
	};

	return (
		<RequestContext.Provider value={[request, updateRequest]}>
			{children}
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
