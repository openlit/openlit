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
