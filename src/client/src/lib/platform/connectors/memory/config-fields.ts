/**
 * Shared config-field builders for memory connector descriptors.
 *
 * Reuse the HTTP endpoint/SSRF toggles from the datasource field helpers so
 * memory vendors stay on the same form schema. Labels come from the CE
 * message catalog.
 */

import getMessage from "@/constants/messages";
import {
	allowHttpField,
	allowPrivateNetworkField,
	endpointField,
} from "../datasource/config-fields";
import type { FieldDef } from "../datasource/types";
import type { MemoryFilterField, MemoryFilterKey } from "./types";

export function memoryApiKeyField(): FieldDef {
	const messages = getMessage();
	return {
		key: "apiKey",
		label: messages.DATA_SOURCE_FIELD_API_KEY,
		kind: "password",
		group: "credentials",
	};
}

/** Standard HTTP memory vendor: endpoint, SSRF toggles, and an API key. */
export function memoryHttpVendorFields(opts: { placeholder?: string } = {}): FieldDef[] {
	return [
		{
			...endpointField(opts.placeholder),
			defaultValue: opts.placeholder,
		},
		allowHttpField(),
		allowPrivateNetworkField(),
		memoryApiKeyField(),
	];
}

/** Memory page filters declared on a vendor `describe()`. Custom values are allowed by default. */
export function memoryPageFilters(
	fields: Array<
		| MemoryFilterKey
		| (Pick<MemoryFilterField, "key"> &
				Partial<
					Pick<
						MemoryFilterField,
						"label" | "required" | "writeRequired" | "allowCustom"
					>
				>)
	>
): MemoryFilterField[] {
	const messages = getMessage();
	const labels: Record<MemoryFilterKey, string> = {
		userId: messages.MEMORY_USER_FILTER,
		sessionId: messages.MEMORY_SESSION_FILTER,
		agentId: messages.MEMORY_AGENT_FILTER,
	};
	return fields.map((field) => {
		const spec = typeof field === "string" ? { key: field } : field;
		return {
			key: spec.key,
			label: spec.label || labels[spec.key],
			required: spec.required,
			writeRequired: spec.writeRequired,
			allowCustom: spec.allowCustom !== false,
		};
	});
}
