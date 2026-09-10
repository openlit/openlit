/**
 * Neutral connector contracts shared by all integration categories.
 *
 * Connector instances are configuration records. Category-specific adapters
 * (datasource, notification, memory, etc.) own their runtime methods.
 */

export type ConnectorCategory =
	| "datasource"
	| "notification"
	| "memory"
	| "vector-store"
	| "model-provider";

export type ConnectorScope = "organisation" | "project";

export type ConnectorStatus = "active" | "disabled" | "error";

export interface ConnectorField {
	key: string;
	label: string;
	kind: "text" | "password" | "url" | "email" | "number" | "boolean" | "select";
	secret?: boolean;
	required?: boolean;
	placeholder?: string;
	options?: { value: string; label: string }[];
	defaultValue?: string | number | boolean;
}

export interface ConnectorCapabilities {
	[key: string]: boolean | string | number | string[] | undefined;
}

export interface ConnectorTypeDescriptor {
	type: string;
	category: ConnectorCategory;
	displayName: string;
	description?: string;
	icon?: string;
	scope: ConnectorScope | "either";
	configFields: ConnectorField[];
	capabilities: ConnectorCapabilities;
	internal?: boolean;
	/** Commercial availability marker; CE defaults to free when omitted. */
	plan?: "free" | "enterprise";
}

export interface ConnectorInstanceDescriptor {
	id: string;
	type: string;
	category: ConnectorCategory;
	name: string;
	organisationId?: string | null;
	projectId?: string | null;
	environment?: string;
	settings: Record<string, unknown>;
	secretRef?: string | null;
	status?: ConnectorStatus;
}

export interface ConnectorHealthResult {
	ok: boolean;
	message?: string;
	latencyMs?: number;
}

export interface ConnectorRuntime {
	healthCheck(): Promise<ConnectorHealthResult>;
}

export interface ConnectorTypeRegistration {
	descriptor: ConnectorTypeDescriptor;
	create?: (instance: ConnectorInstanceDescriptor) => ConnectorRuntime;
}
