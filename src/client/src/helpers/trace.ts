import {
	TraceMapping,
	TraceMappingKeyType,
	TraceRow,
	TransformedTraceRow,
} from "@/constants/traces";
import { round } from "lodash";

export const integerParser = (value: string, offset?: number) =>
	parseInt((value || "0") as string, 10) * (offset || 1);

export const floatParser = (value: string, offset?: number) =>
	parseFloat((value || "0") as string) * (offset || 1);

export const normalizeTrace = (item: TraceRow): TransformedTraceRow => {
	return Object.keys(TraceMapping).reduce(
		(acc: TransformedTraceRow, traceKey: TraceMappingKeyType) => {
			let value: unknown;
			if (TraceMapping[traceKey].isRoot) {
				value = item[TraceMapping[traceKey].path as keyof TraceRow];
			} else {
				value = item.SpanAttributes[getTraceMappingKeyFullPath(traceKey)];
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
					);
				} else if (TraceMapping[traceKey].type === "round") {
					acc[traceKey] = round(value as number, TraceMapping[traceKey].offset);
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

export const getTraceMappingKeyFullPath = (key: TraceMappingKeyType) => {
	if (!TraceMapping[key].prefix) return TraceMapping[key].path;
	return [TraceMapping[key].prefix, TraceMapping[key].path].join(".");
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
			return ["applicationName", "provider", "endpoint", "owner", "repo", ""];
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

export const getRequestDetailsDisplayKeys = (
	type: string
): TraceMappingKeyType[] => {
	let keys: TraceMappingKeyType[] = getRequestTableDisplayKeys(type);
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
