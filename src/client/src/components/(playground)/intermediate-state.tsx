import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";

export type IntermediateState = {
	type: "loading" | "nodata";
	children?: ReactNode;
	classNames?: string;
};
export default function IntermediateState(props: IntermediateState) {
	if (props.type === "loading")
		return props.children ? (
			props.children
		) : (
			<div
				className={`flex w-full items-center justify-center gap-2 p-3 text-sm text-stone-500 dark:text-stone-400 ${
					props.classNames || ""
				}`}
			>
				<Loader2 className="h-4 w-4 animate-spin shrink-0" />
				Loading...
			</div>
		);
	if (props.type === "nodata")
		return (
			<div
				className={`flex w-full items-center justify-center p-3 text-sm text-stone-500 dark:text-stone-400 ${
					props.classNames || ""
				}`}
			>
				No data to display
			</div>
		);

	return null;
}
