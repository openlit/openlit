export type ControllerMode = "linux" | "docker" | "kubernetes" | "standalone";
export type InstrumentationStatus = "discovered" | "instrumented";
export type ControllerHealth = "healthy" | "active" | "degraded" | "error" | "inactive";

export interface ControllerInstance {
	id: string;
	instance_id: string;
	cluster_id: string;
	node_name: string;
	version: string;
	mode: ControllerMode;
	status: ControllerHealth;
	computed_status?: ControllerHealth;
	listen_addr: string;
	external_url: string;
	services_discovered: number;
	services_instrumented: number;
	last_heartbeat: string;
	config_hash: string;
	resource_attributes?: Record<string, string>;
	created_at: string;
}

export interface ControllerService {
	id: string;
	controller_instance_id: string;
	cluster_id: string;
	service_name: string;
	workload_key: string;
	namespace: string;
	language_runtime: string;
	llm_providers: string[];
	open_ports: number[];
	deployment_name: string;
	pid: number;
	exe_path: string;
	instrumentation_status: InstrumentationStatus;
	desired_instrumentation_status: "none" | "instrumented";
	desired_agent_status: "none" | "enabled";
	resource_attributes?: Record<string, string>;
	first_seen: string;
	last_seen: string;
	updated_at: string;
	pending_action?: string | null;
	pending_action_status?: "pending" | "acknowledged" | null;
	last_error?: string | null;
	last_error_action?: ActionType | null;
}

export interface ExportConfig {
	otlp_endpoint: string;
	otlp_headers: Record<string, string>;
	otlp_protocol: string;
}

export interface DiscoveryTarget {
	service_name?: string;
	open_ports?: string;
	exe_path?: string;
	cmd_args?: string;
}

export interface K8sSelector {
	namespace?: string;
	deployment_name?: string;
}

export interface K8sDiscovery {
	enabled: string;
	instrument: K8sSelector[];
	exclude: K8sSelector[];
}

export interface DiscoveryConfig {
	auto_discover: boolean;
	instrument: DiscoveryTarget[];
	exclude: DiscoveryTarget[];
	kubernetes?: K8sDiscovery;
}

export interface PayloadExtractionConfig {
	openai: boolean;
	anthropic: boolean;
	gemini: boolean;
	cohere: boolean;
	mistral: boolean;
	groq: boolean;
	azure_openai: boolean;
	azure_inference: boolean;
	bedrock: boolean;
	vercel_ai: boolean;
	vertex_ai: boolean;
	litellm: boolean;
	deepseek: boolean;
	together: boolean;
	fireworks: boolean;
	ollama: boolean;
}

export interface ControllerConfig {
	export: ExportConfig;
	discovery: DiscoveryConfig;
	payload_extraction: PayloadExtractionConfig;
	custom_llm_hosts?: string[];
	environment?: string;
	poll_interval_seconds?: number;
}

export type ActionType = string;
export type ActionStatus = "pending" | "acknowledged" | "completed" | "failed";

export const KNOWN_ACTIONS = {
	INSTRUMENT: "instrument",
	UNINSTRUMENT: "uninstrument",
	ENABLE_AGENT: "enable_python_sdk",
	DISABLE_AGENT: "disable_python_sdk",
	PUSH_PROMPTS: "push_prompts",
	REMOVE_PROMPTS: "remove_prompts",
	PUSH_ENVS: "push_envs",
	REMOVE_ENVS: "remove_envs",
} as const;

export interface FeatureDesiredState {
	workload_key: string;
	cluster_id: string;
	feature: string;
	desired_status: string;
	config: string;
	updated_at: string;
}

export interface EnvironmentFeatureConfig {
	environment: string;
	cluster_id: string;
	feature: string;
	config: string;
	updated_at: string;
}

export interface PromptConfig {
	templates: Array<{ name: string; content: string; version: number }>;
}

export interface EnvConfig {
	variables: Record<string, string>;
	secrets_masked?: boolean;
}

export type PythonSDKActionRuntime = "python";
export type PythonSDKInstrumentationProfile = "controller_managed";
export type PythonSDKDuplicatePolicy =
	| "prefer_sdk_agent_spans"
	| "prefer_obi_llm_spans"
	| "block_if_existing_otel_detected";
export type PythonSDKObservabilityScope = "agent";

export interface PythonSDKActionPayload {
	target_runtime: PythonSDKActionRuntime;
	instrumentation_profile: PythonSDKInstrumentationProfile;
	duplicate_policy: PythonSDKDuplicatePolicy;
	observability_scope: PythonSDKObservabilityScope;
	otlp_endpoint?: string | null;
	sdk_version?: string;
	enable_http_instrumentation?: boolean;
	resource_attributes?: Record<string, string>;
}

export interface PendingAction {
	id: string;
	instance_id: string;
	action_type: ActionType;
	service_key: string;
	payload: string;
	status: ActionStatus;
	result: string;
	created_at: string;
	updated_at: string;
}
