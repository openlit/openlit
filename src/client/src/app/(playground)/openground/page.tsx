"use client";

import PromptInput from "./prompt-input";
import Providers from "./providers";

export default function Openground() {
	return (
		<div className="flex flex-col w-full h-full gap-4">
			<h1 className="text-lg text-bold">Compare your providers</h1>
			<Providers />
			<PromptInput />
		</div>
	);
}
