import {
	TraceMapping,
	TraceMappingKeyType,
	TraceRow,
	TransformedTraceRow,
} from "@/constants/traces";

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
				acc[traceKey] = parseInt((value || "0") as string, 10);
			} else if (TraceMapping[traceKey].type === "integer") {
				acc[traceKey] = parseFloat((value || "0") as string);
			} else {
				acc[traceKey] = value;
			}
			return acc;
		},
		{}
	);
};

export const getTraceMappingKeyFullPath = (key: TraceMappingKeyType) => {
	return [TraceMapping[key].prefix || "", TraceMapping[key].path].join(".");
};
