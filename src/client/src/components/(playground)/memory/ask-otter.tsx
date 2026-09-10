"use client";

import getMessage from "@/constants/messages";
import {
	buildMemoryAskPrompt,
	memoryAskSelectedSummary,
	type MemoryAskScope,
} from "@/lib/platform/connectors/memory/ask";
import AskOtterPanel from "@/components/(playground)/chat/ask-otter-panel";

type AskOtterBarProps = {
	disabled?: boolean;
	scope?: MemoryAskScope;
	/** Pass `fill` when embedding beside a resizable host panel. */
	layout?: "dock" | "fill";
	className?: string;
};

/** Memory-page adapter around the shared Ask Otter panel. */
export default function AskOtterBar({
	disabled,
	scope,
	layout = "dock",
	className,
}: AskOtterBarProps) {
	const messages = getMessage();
	const selected = memoryAskSelectedSummary(scope);
	return (
		<AskOtterPanel
			disabled={disabled}
			layout={layout}
			className={className}
			copy={{
				title: messages.MEMORY_ASK_TITLE,
				empty: messages.MEMORY_ASK_EMPTY,
				placeholder: messages.MEMORY_ASK_PLACEHOLDER,
				hint: messages.MEMORY_ASK_HINT,
				send: messages.MEMORY_ASK_SEND,
				conversationTitle: messages.MEMORY_ASK_TITLE,
			}}
			contextLabel={selected ? messages.MEMORY_ASK_SELECTED_CHIP(selected) : undefined}
			buildPrompt={(question) => buildMemoryAskPrompt(question, scope)}
		/>
	);
}
