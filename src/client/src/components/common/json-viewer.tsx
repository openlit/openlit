import { jsonParse } from "@/utils/json";
import {
	JsonViewer,
	JsonViewerProps,
	defineEasyType,
} from "@textea/json-viewer";
import useTheme from "@/utils/hooks/useTheme";

const integerType = defineEasyType<string>({
	is: (value) => typeof value === "string" && /^-?\d+$/.test(value),
	type: "number",
	colorKey: "base0C",
	// Rendered verbatim: long numeric ids exceed Number.MAX_SAFE_INTEGER.
	Renderer: (props) => props.value,
});

const objectType = defineEasyType<string>({
	is: (value) => {
		if (typeof value !== "string" || !/^\[|\{/.test(value)) {
			return false;
		}
		return jsonParse(value);
	},
	type: "object",
	colorKey: "base0E",
	Renderer: (props) => props.value,
});

const booleanType = defineEasyType<string>({
	is: (value) => {
		return value === "true" || value === "false";
	},
	type: "bool",
	colorKey: "base0E",
	Renderer: (props) => {
		return `${!!(props.value === "true")}`;
	},
});

export default function JSONViewer(props: JsonViewerProps) {
	const { theme } = useTheme();

	return (
		<JsonViewer
			value={props.value}
			className={`bg-transparent dark:bg-transparent text-success dark:text-success ${props.className}`}
			enableClipboard={props.enableClipboard ?? true}
			displayDataTypes={props.displayDataTypes || false}
			displaySize={props.displaySize || false}
			rootName={props.rootName || false}
			valueTypes={[integerType, objectType, booleanType]}
			maxDisplayLength={20}
			theme={theme}
		/>
	);
}
