export type AlertStatus = "active" | "paused";
export type AlertSeverity = "low" | "medium" | "high" | "critical";
export type AlertTriggerType =
	| "access_update"
	| "invite"
	| "prompt_version_update"
	| "fleet_hub_config_update"
	| "vault_secret_change"
	| "context_change"
	| "rule_engine_change";

export type AlertProviderType =
	| "slack"
	| "email"
	| "webhook"
	| "datadog"
	| "teams"
	| "pagerduty"
	| "opsgenie"
	| "discord";

export type AlertEventStatus = "pending" | "success" | "partial_failure" | "failure";
export type AlertDeliveryStatus = "pending" | "success" | "failure" | "skipped";

export type AlertConditionInput = {
	field: string;
	operator: string;
	value: string;
	data_type?: "string" | "number" | "boolean";
};

export type AlertConditionGroupInput = {
	condition_operator?: "AND" | "OR";
	conditions: AlertConditionInput[];
};

export type AlertDestinationBindingInput = {
	destinationId: string;
	overrides?: Record<string, unknown>;
};

export type AlertInput = {
	name: string;
	description?: string;
	status?: AlertStatus;
	severity?: AlertSeverity;
	triggerType?: AlertTriggerType;
	triggerTypes?: AlertTriggerType[];
	triggerConfig?: Record<string, unknown>;
	ruleId?: string | null;
	conditionGroups?: AlertConditionGroupInput[];
	destinationIds?: string[];
	destinations?: AlertDestinationBindingInput[];
	projectId?: string | null;
	databaseConfigId?: string | null;
	cooldownSeconds?: number;
	dedupeKey?: string | null;
};

export type AlertDestinationInput = {
	name: string;
	providerType: AlertProviderType;
	status?: AlertStatus;
	config?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
};

export type AlertSignalInput = {
	triggerType: AlertTriggerType;
	fields: Record<string, string | number | boolean>;
	organisationId?: string;
	projectId?: string | null;
	databaseConfigId?: string | null;
	sourceId?: string | null;
	payloadSummary?: Record<string, unknown>;
};

export type ManagementAlertInput = {
	triggerType: AlertTriggerType;
	event: string;
	message: string;
	sourceId?: string | null;
	fields?: Record<string, string | number | boolean | undefined | null>;
	payloadSummary?: Record<string, unknown>;
	databaseConfigId?: string | null;
};

export type ProviderFieldDefinition = {
	key: string;
	label: string;
	type: "string" | "number" | "boolean" | "password" | "url" | "email" | "string[]";
	required?: boolean;
	secret?: boolean;
	description?: string;
	placeholder?: string;
};

export type AlertProviderCapability =
	| "notify"
	| "test"
	| "webhook"
	| "metadata";

export type AlertProviderMetadata = {
	type: AlertProviderType;
	name: string;
	description: string;
	category: "chat" | "email" | "incident" | "observability" | "webhook";
	tags: string[];
	capabilities: AlertProviderCapability[];
	configSchema: ProviderFieldDefinition[];
	credentialSchema?: ProviderFieldDefinition[];
};

export type AlertProviderPayload = {
	title: string;
	message: string;
	severity: AlertSeverity;
	alertId?: string;
	alertName?: string;
	eventId?: string;
	triggerType?: AlertTriggerType;
	fields?: Record<string, unknown>;
	url?: string;
	presentation?: {
		style?: "default" | "compact" | "detailed" | "incident";
		accentColor?: string;
		includeFields?: boolean;
	};
};

export type AlertProviderSendResult = {
	success: boolean;
	statusCode?: number;
	response?: Record<string, unknown>;
	error?: string;
};
