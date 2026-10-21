/**
 * Shared value helpers for memory connectors.
 *
 * Adapters keep vendor-specific parsing local. These helpers are the copies
 * that were identical across Claude, LangGraph, Mem0, MemCode, Zep, and the
 * read path. Zep keeps its own stringValue because Zep ids can be numbers.
 */

import type { MemoryFilterChoice, MemoryWriteInput } from "./types";

export function isPlainObject(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

export function asRecord(value: unknown): Record<string, unknown> {
	return isPlainObject(value) ? value : {};
}

export function stringValue(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed || undefined;
}

export function uniqueChoices(choices: MemoryFilterChoice[]): MemoryFilterChoice[] {
	const seen = new Set<string>();
	const next: MemoryFilterChoice[] = [];
	for (const choice of choices) {
		if (!choice.id || seen.has(choice.id)) continue;
		seen.add(choice.id);
		next.push(choice);
	}
	return next.sort((a, b) => a.label.localeCompare(b.label));
}

/** Content field, or the joined text of messages when content is empty. */
export function writeContent(input: MemoryWriteInput): string {
	const content = stringValue(input.content);
	if (content) return content;
	return (input.messages || [])
		.map((message) => stringValue(message.content))
		.filter((item): item is string => !!item)
		.join("\n")
		.trim();
}
