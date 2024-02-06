import { noop } from "@/utils/noop";
import { ReactNode, createContext, useContext, useState } from "react";

export const RequestMappings = {
	applicationname: {
		label: "Application Name",
		type: "string",
	},
	audiovoice: {
		label: "Audio Voice",
		type: "string",
	},
	completiontokens: {
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
	finetunejobid: {
		label: "Fine Tune Job Id",
		type: "string",
	},
	finetunejobstatus: {
		label: "Fine Tune Job Status",
		type: "string",
	},
	finishreason: {
		label: "Finish Reason",
		type: "string",
	},
	image: {
		label: "Image",
		type: "string",
	},
	imagesize: {
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
	prompttokens: {
		label: "Prompt Tokens",
		type: "string",
	},
	requestduration: {
		label: "Request Duration",
		type: "string",
	},
	response: {
		label: "Response",
		type: "string",
	},
	sourcelanguage: {
		label: "Source Language",
		type: "string",
	},
	time: {
		label: "Time",
		type: "string",
	},
	totaltokens: {
		label: "Total Tokens",
		type: "string",
	},
	usagecost: {
		label: "Usage Cost",
		type: "string",
	},
};

export const DisplayDataRequestMappingKeys: Array<
	keyof typeof RequestMappings
> = [
	"applicationname",
	"endpoint",
	"model",
	"requestduration",
	"prompttokens",
	"totaltokens",
	"usagecost",
	"time",
	"sourcelanguage",
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
