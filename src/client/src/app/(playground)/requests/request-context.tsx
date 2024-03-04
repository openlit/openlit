import { noop } from "@/utils/noop";
import { ReactNode, createContext, useContext, useState } from "react";

export const RequestMappings = {
	applicationName: {
		label: "Application Name",
		type: "string",
	},
	audioVoice: {
		label: "Audio Voice",
		type: "string",
	},
	completionTokens: {
		label: "Completion Tokens",
		type: "string",
	},
	endpoint: {
		label: "Endpoint",
		type: "string",
	},
	environment: {
		label: "Environment",
		type: "string",
	},
	finetuneJobid: {
		label: "Fine Tune Job Id",
		type: "string",
	},
	finetuneJobStatus: {
		label: "Fine Tune Job Status",
		type: "string",
	},
	finishReason: {
		label: "Finish Reason",
		type: "string",
	},
	id: {
		label: "Id",
		type: "string",
	},
	image: {
		label: "Image",
		type: "string",
	},
	imageSize: {
		label: "Image Size",
		type: "string",
	},
	model: {
		label: "Model",
		type: "string",
	},
	name: {
		label: "Name",
		type: "string",
	},
	prompt: {
		label: "Prompt",
		type: "string",
	},
	promptTokens: {
		label: "Prompt Tokens",
		type: "string",
	},
	requestDuration: {
		label: "Request Duration",
		type: "string",
	},
	response: {
		label: "Response",
		type: "string",
	},
	revisedPrompt: {
		label: "Revised Prompt",
		type: "string",
	},
	sourceLanguage: {
		label: "Source Language",
		type: "string",
	},
	time: {
		label: "Time",
		type: "string",
	},
	totalTokens: {
		label: "Total Tokens",
		type: "string",
	},
	usageCost: {
		label: "Usage Cost",
		type: "string",
	},
};

export const DisplayDataRequestMappingKeys: Array<
	keyof typeof RequestMappings
> = [
	"applicationName",
	"endpoint",
	"model",
	"requestDuration",
	"promptTokens",
	"totalTokens",
	"usageCost",
	"time",
	"sourceLanguage",
];

type RequestProps = Record<keyof typeof RequestMappings, any> | null;

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
