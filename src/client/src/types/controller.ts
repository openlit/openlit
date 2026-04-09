export type ControllerMode = "linux" | "docker" | "kubernetes";
export type InstrumentationStatus = "discovered" | "instrumented";
export type ControllerHealth = "healthy" | "degraded" | "error";

export interface ControllerInstance {
	id: string;
	instance_id: string;
	node_name: string;
	version: string;
	mode: ControllerMode;
	status: ControllerHealth;
	listen_addr: string;
	external_url: string;
	services_discovered: number;
	services_instrumented: number;
	last_heartbeat: string;
	config_hash: string;
	created_at: string;
}

export interface ControllerService {
	id: string;
	controller_instance_id: string;
	service_name: string;
	namespace: string;
	language_runtime: string;
	llm_providers: string[];
	open_ports: number[];
	deployment_name: string;
	pid: number;
	exe_path: string;
	instrumentation_status: InstrumentationStatus;
	first_seen: string;
	last_seen: string;
	updated_at: string;
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
}

export interface ControllerStatus {
	status: string;
	mode: ControllerMode;
	version: string;
	node_name: string;
	os: string;
	arch: string;
	engine: {
		running: boolean;
		services_discovered: number;
		services_instrumented: number;
	};
}

export type ActionType = "instrument" | "uninstrument" | "apply_config";
export type ActionStatus = "pending" | "acknowledged" | "completed" | "failed";

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
