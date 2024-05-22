"use client";

import PromptInput from "./prompt-input";
import Providers from "./providers";

export default function Evaluate() {
	return (
		<>
			<Providers />
			<PromptInput />
		</>
	);
}
