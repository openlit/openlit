import {
	TraceMapping,
	TraceMappingKeyType,
	TraceRow,
	TransformedTraceRow,
} from "@/constants/traces";
import { get, round } from "lodash";

export const integerParser = (value: string, offset?: number) =>
	parseInt((value || "0") as string, 10) * (offset || 1);

export const floatParser = (value: string, offset?: number) =>
	parseFloat((value || "0") as string) * (offset || 1);

export const normalizeTrace = (item: TraceRow): TransformedTraceRow => {
	return Object.keys(TraceMapping).reduce(
		(acc: TransformedTraceRow, traceKey: TraceMappingKeyType) => {
			let value: unknown;
			if (TraceMapping[traceKey].isRoot) {
				value = get(item, TraceMapping[traceKey].path);
			} else {
				value = get(item.SpanAttributes, getTraceMappingKeyFullPath(traceKey));
			}

			if (value) {
				if (TraceMapping[traceKey].type === "integer") {
					acc[traceKey] = integerParser(
						value as string,
						TraceMapping[traceKey].offset
					);
				} else if (TraceMapping[traceKey].type === "float") {
					acc[traceKey] = floatParser(
						(value || "0") as string,
						TraceMapping[traceKey].offset
					).toFixed(10);
				} else if (TraceMapping[traceKey].type === "round") {
					acc[traceKey] = round(
						value as number,
						TraceMapping[traceKey].offset
					).toFixed(10);
				} else {
					acc[traceKey] = value;
				}
			} else {
				acc[traceKey] = TraceMapping[traceKey].defaultValue;
			}

			return acc;
		},
		{}
	);
};

export const getTraceMappingKeyFullPath = (
	key: TraceMappingKeyType,
	shouldReturnArray: boolean = false
) => {
	if (!TraceMapping[key].prefix) {
		if (!shouldReturnArray) {
			if (typeof TraceMapping[key].path !== "string") {
				return (TraceMapping[key].path as string[]).join(".");
			}
		}
		return TraceMapping[key].path;
	}
	if (shouldReturnArray) {
		let returnArr: string[] = [];
		if (typeof TraceMapping[key].prefix === "string") {
			returnArr = returnArr.concat([TraceMapping[key].prefix as string]);
		} else {
			returnArr = returnArr.concat(TraceMapping[key].prefix as string[]);
		}

		if (typeof TraceMapping[key].path === "string") {
			returnArr = returnArr.concat([TraceMapping[key].path as string]);
		} else {
			returnArr = returnArr.concat(TraceMapping[key].path as string[]);
		}
		return returnArr;
	}

	let returnString = "";
	if (typeof TraceMapping[key].prefix === "string") {
		returnString = TraceMapping[key].prefix as string;
	} else {
		returnString = (TraceMapping[key].prefix as string[]).join(".");
	}

	if (typeof TraceMapping[key].path === "string") {
		returnString = [returnString, TraceMapping[key].path as string].join(".");
	} else {
		returnString = [
			returnString,
			(TraceMapping[key].path as string[]).join("."),
		].join(".");
	}

	return returnString;
};

export const getRequestTableDisplayKeys = (
	type: string
): TraceMappingKeyType[] => {
	switch (type) {
		case "vectordb":
			return [
				"applicationName",
				"system",
				"operation",
				"documentsCount",
				"idsCount",
				"vectorCount",
			];
		case "framework":
			return ["applicationName", "provider", "endpoint", "owner", "repo"];
		default:
			return [
				"applicationName",
				"provider",
				"model",
				"cost",
				"promptTokens",
				"totalTokens",
			];
	}
};

export const getDisplayKeysForException = (): TraceMappingKeyType[] => {
	return ["serviceName", "spanName", "deploymentType", "exceptionType"];
};

export const getRequestDetailsDisplayKeys = (
	type: string,
	isException?: boolean
): TraceMappingKeyType[] => {
	let keys: TraceMappingKeyType[] = isException
		? getDisplayKeysForException()
		: getRequestTableDisplayKeys(type);
	if (isException) {
		return keys.filter((i) => !["serviceName"].includes(i));
	}

	switch (type) {
		case "vectordb":
			keys = keys.concat(["environment", "type", "nResults", "endpoint"]);
			break;
		case "framework":
			keys = keys.concat(["environment", "type"]);
			break;
		default:
			keys = keys.concat([
				"environment",
				"type",
				"audioVoice",
				"audioFormat",
				"audioSpeed",
				"imageSize",
				"imageQuality",
				"imageStyle",
				"endpoint",
			]);
			break;
	}

	return keys.filter(
		(i) => !["applicationName", "provider", "system"].includes(i)
	);
};
