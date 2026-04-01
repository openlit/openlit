import { Resource } from '@opentelemetry/resources';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { metrics } from '@opentelemetry/api';

export type InstrumentationType = 'openai' | 'anthropic' | 'cohere' | 'groq' | 'mistral' | 'google-ai' | 'together' | 'ollama' | 'vercel-ai' | 'langchain' | 'langgraph' | 'pinecone' | 'bedrock' | 'llamaindex' | 'huggingface' | 'replicate' | 'chroma' | 'qdrant' | 'milvus' | 'azure-ai-inference' | 'openai-agents' | 'mastra' | 'strands' | 'google-adk' | 'claude-agent-sdk';

export type OpenlitInstrumentations = Partial<Record<InstrumentationType, any>>;

export type PricingObject = Record<string, Record<string, unknown>>;

/**
 * Internal config interface used by OpenlitConfig.
 */
export interface OpenlitConfigInterface {
  environment?: string;
  applicationName?: string;
  pricingInfo?: PricingObject;
  tracer: NodeTracerProvider;
  otlpEndpoint?: string;
  otlpHeaders?: Record<string, unknown>;
  disableBatch?: boolean;
  captureMessageContent?: boolean;
  pricingJson?: string | PricingObject;
  disableMetrics?: boolean;
  disableEvents?: boolean;
  maxContentLength?: number | null;
  customSpanAttributes?: Record<string, string> | null;
}

/**
 * Public init() options.
 *
 * Names match the Python SDK's init() parameters in camelCase form:
 *   Python: application_name     → JS: applicationName
 *   Python: otlp_endpoint        → JS: otlpEndpoint
 *   Python: otlp_headers         → JS: otlpHeaders
 *   Python: disable_batch        → JS: disableBatch
 *   Python: capture_message_content → JS: captureMessageContent
 *   Python: disabled_instrumentors  → JS: disabledInstrumentors
 *   Python: disable_metrics      → JS: disableMetrics
 *   Python: disable_events       → JS: disableEvents
 *   Python: pricing_json         → JS: pricingJson
 *   Python: max_content_length   → JS: maxContentLength
 *   Python: custom_span_attributes → JS: customSpanAttributes
 */
export type OpenlitOptions = {
  environment?: string;
  applicationName?: string;
  tracer?: NodeTracerProvider;
  otlpEndpoint?: string;
  otlpHeaders?: Record<string, unknown>;
  disableBatch?: boolean;
  captureMessageContent?: boolean;
  disabledInstrumentors?: string[];
  instrumentations?: OpenlitInstrumentations;
  disableMetrics?: boolean;
  disableEvents?: boolean;
  pricingJson?: string | PricingObject;
  maxContentLength?: number | null;
  customSpanAttributes?: Record<string, string> | null;

};

/**
 * Resolved options used internally after merging args, env vars, and defaults.
 */
export interface ResolvedOptions {
  environment: string;
  applicationName: string;
  tracer?: NodeTracerProvider;
  otlpEndpoint?: string;
  otlpHeaders?: Record<string, unknown>;
  disableBatch: boolean;
  captureMessageContent: boolean;
  disabledInstrumentors?: string[];
  instrumentations?: OpenlitInstrumentations;
  disableMetrics: boolean;
  disableEvents: boolean;
  pricingJson?: string | PricingObject;
  maxContentLength?: number | null;
  customSpanAttributes?: Record<string, string> | null;
}

export type SetupTracerOptions = ResolvedOptions & {
  resource: Resource;
};

export type MeterType = ReturnType<typeof metrics.getMeter>;

export type SetupMetricsOptions = SetupTracerOptions & {
  meter?: MeterType;
  exportIntervalMillis?: number;
};

export type SetupEventsOptions = SetupTracerOptions;

export interface BaseOpenlitOptions {
  url?: string;
  apiKey?: string;
}

export interface PromptHubOptions extends BaseOpenlitOptions {
  name?: string;
  version?: string;
  shouldCompile?: boolean;
  variables?: Record<string, any>;
  promptId?: string;
  metaProperties?: Record<string, any>;
}

export interface VaultOptions extends BaseOpenlitOptions {
  key?: string;
  tags?: string[];
  shouldSetEnv?: boolean;
}

export type RuleEntityType = 'context' | 'prompt' | 'evaluation';

export interface RuleEngineOptions extends BaseOpenlitOptions {
  entityType: RuleEntityType;
  fields: Record<string, string | number | boolean>;
  includeEntityData?: boolean;
  entityInputs?: Record<string, any>;
}

export interface RuleEngineResult {
  matchingRuleIds: string[];
  entities: Array<{ rule_id: string; entity_type: string; entity_id: string }>;
  entity_data?: Record<string, any>;
}
