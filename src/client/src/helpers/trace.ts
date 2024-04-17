import {
	TraceMapping,
	TraceMappingKeyType,
	TraceRow,
	TransformedTraceRow,
} from "@/constants/traces";

export const integerParser = (value: string, multiplier?: number) =>
	parseInt((value || "0") as string, 10) * (multiplier || 1);

export const floatParser = (value: string, multiplier?: number) =>
	parseFloat((value || "0") as string) * (multiplier || 1);

export const normalizeTrace = (item: TraceRow): TransformedTraceRow => {
	return Object.keys(TraceMapping).reduce(
		(acc: TransformedTraceRow, traceKey: TraceMappingKeyType) => {
			let value: unknown;
			if (TraceMapping[traceKey].isRoot) {
				value = item[TraceMapping[traceKey].path as keyof TraceRow];
			} else {
				value = item.SpanAttributes[getTraceMappingKeyFullPath(traceKey)];
			}

			if (TraceMapping[traceKey].type === "integer") {
				acc[traceKey] = integerParser(
					value as string,
					TraceMapping[traceKey].multiplier
				);
			} else if (TraceMapping[traceKey].type === "float") {
				acc[traceKey] = floatParser(
					(value || "0") as string,
					TraceMapping[traceKey].multiplier
				);
			} else {
				acc[traceKey] = value;
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
