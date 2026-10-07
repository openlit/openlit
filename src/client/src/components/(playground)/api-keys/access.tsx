"use client";
// Community edition: API keys always have full access. The enterprise build
// overrides this module with per-feature access controls.
import { ShieldCheck } from "lucide-react";
import { ApiKey } from "@/types/api-key";
import getMessage from "@/constants/messages";

// `null` = full access; an array restricts the key to those features.
export type ApiKeyAccessValue = string[] | null;

export function ApiKeyAccessSelector(_props: {
	value: ApiKeyAccessValue;
	onChange: (value: ApiKeyAccessValue) => void;
}) {
	return null;
}

export function ApiKeyAccessCell(_props: { apiKey: ApiKey }) {
	const messages = getMessage();
	return (
		<span
			title={messages.API_KEY_FULL_ACCESS_DESCRIPTION}
			className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300"
		>
			<ShieldCheck className="h-3.5 w-3.5" />
			{messages.API_KEY_FULL_ACCESS}
		</span>
	);
}

// Row action for editing a key's access; nothing to edit in this edition.
export function ApiKeyAccessAction(_props: {
	apiKey: ApiKey;
	onUpdated: () => void;
}) {
	return null;
}
