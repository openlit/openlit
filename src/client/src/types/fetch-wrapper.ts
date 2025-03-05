export type FetchWrapperProps = {
	body?: string;
	failureCb?: (s?: string) => void;
	url: string;
	requestType: "GET" | "POST" | "DELETE" | "PUT";
	responseDataKey?: string;
	successCb?: (res?: any) => void;
};
