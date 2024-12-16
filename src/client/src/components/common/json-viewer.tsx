import { jsonParse, jsonStringify } from "@/utils/json";
import {
	JsonViewer,
	JsonViewerProps,
	defineDataType,
	defineEasyType,
} from "@textea/json-viewer";
import { isInteger, isString } from "lodash";

// const imageType = defineDataType<string>({
// 	is: (value) => {
// 		if (typeof value !== "string") return false;
// 		try {
// 			const url = new URL(value);
// 			return /\.png|\.jpg|\.gif|\.svg$/.test(url.pathname);
// 		} catch {
// 			return false;
// 		}
// 	},
// 	Component: (props) => {
// 		return (
// 			<img
// 				height={48}
// 				width={48}
// 				src={props.value}
// 				alt={"hello"}
// 				style={{ display: "inline-block" }}
// 			/>
// 		);
// 	},
// });

const integerType = defineEasyType<string>({
	is: (value) => {
		const changedValue = parseInt(value as string, 10);
		return isInteger(changedValue);
	},
	type: "number",
	colorKey: "base0C",
	Renderer: (props) => parseInt(props.value, 10),
});

const objectType = defineEasyType<string>({
	is: (value) => {
		if (!/^\[|\{/.test(value as string)) return false;
		return jsonParse(value as string);
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
		return `${props.value === "true" ? true : false}`;
	},
});

// const stringType = defineEasyType<string>({
// 	is: (value) => {
// 		return isString(value);
// 	},
// 	type: "string",
// 	colorKey: "base0A",
// 	Renderer: (props) => {
// 		return props.value;
// 	},
// });

export default function JSONViewer(props: JsonViewerProps) {
	return (
		<JsonViewer
			value={props.value}
			className={`bg-transparent dark:bg-transparent text-success dark:text-success ${props.className}`}
			enableClipboard={props.enableClipboard || true}
			displayDataTypes={props.displayDataTypes || false}
			displaySize={props.displaySize || false}
			rootName={props.rootName || false}
			valueTypes={[integerType, objectType, booleanType]}
			maxDisplayLength={20}
		/>
	);
}
