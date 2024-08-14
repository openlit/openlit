"use client";

import PromptInput from "./prompt-input";
import Providers from "./providers";
import OpengroundHeader from "@/components/(playground)/openground/header";

export default function Openground() {
	return (
		<div className="flex flex-col w-full h-full gap-4">
			<OpengroundHeader title="Compare your providers" validateResponse />
			<Providers />
			<PromptInput />
		</div>
	);
}
