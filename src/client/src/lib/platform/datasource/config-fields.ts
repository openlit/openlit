/**
 * Shared config-field builders for source-type descriptors.
 *
 * Adapters compose these in their `describe().configFields` so the add/edit
 * form stays fully generic (Grafana-style plugin config schema). A new HTTP
 * vendor reuses `httpVendorFields()`; a bespoke vendor declares its own fields.
 * Labels are resolved from the CE message catalog so all user-facing strings
 * stay centralized.
 */

import getMessage from "@/constants/messages";
import type { FieldDef } from "./types";

/** The datasource HTTP endpoint URL field. */
export function endpointField(placeholder?: string): FieldDef {
	const messages = getMessage();
	return {
		key: "url",
		label: messages.DATA_SOURCE_FIELD_ENDPOINT,
		kind: "url",
		group: "settings",
		placeholder,
	};
}

/** Toggle allowing plain-HTTP endpoints (defaults on for local stacks). */
export function allowHttpField(): FieldDef {
	const messages = getMessage();
	return {
		key: "allowHttp",
		label: messages.DATA_SOURCE_FIELD_ALLOW_HTTP,
		kind: "switch",
		group: "settings",
		defaultValue: true,
	};
}

/** Basic (username/password) + Bearer (token) HTTP auth credential fields. */
export function httpAuthFields(): FieldDef[] {
	const messages = getMessage();
	return [
		{
			key: "username",
			label: messages.DATA_SOURCE_FIELD_USERNAME,
			kind: "text",
			group: "credentials",
			placeholder: messages.DATA_SOURCE_FIELD_USERNAME_PLACEHOLDER,
		},
		{
			key: "password",
			label: messages.DATA_SOURCE_FIELD_PASSWORD,
			kind: "password",
			group: "credentials",
			placeholder: messages.DATA_SOURCE_FIELD_PASSWORD_PLACEHOLDER,
		},
		{
			key: "token",
			label: messages.DATA_SOURCE_FIELD_TOKEN,
			kind: "password",
			group: "credentials",
		},
	];
}

/** Multi-tenant org/account id field (X-Scope-OrgID / AccountID). */
export function tenantField(): FieldDef {
	const messages = getMessage();
	return {
		key: "tenant",
		label: messages.DATA_SOURCE_FIELD_TENANT,
		kind: "text",
		group: "credentials",
		placeholder: messages.DATA_SOURCE_FIELD_TENANT_PLACEHOLDER,
	};
}

/**
 * Standard field set for an HTTP OTLP/observability vendor: endpoint URL,
 * plain-HTTP toggle, HTTP basic/bearer auth, and (optionally) a tenant id.
 * Reused by Tempo, Loki, Prometheus/Mimir, Jaeger, and Victoria adapters, and
 * by any future OTLP vendor.
 */
export function httpVendorFields(
	opts: { placeholder?: string; tenant?: boolean } = {}
): FieldDef[] {
	const fields = [endpointField(opts.placeholder), allowHttpField(), ...httpAuthFields()];
	if (opts.tenant) fields.push(tenantField());
	return fields;
}
