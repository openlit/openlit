// import { Instrumentation } from '@opentelemetry/instrumentation';
import { Resource } from '@opentelemetry/resources';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { metrics } from '@opentelemetry/api';

export type InstrumentationType = 'openai' | 'anthropic' | 'cohere' | 'groq' | 'mistral' | 'google-ai' | 'together' | 'ollama' | 'vercel-ai' | 'langchain' | 'pinecone' | 'bedrock' | 'llamaindex' | 'huggingface' | 'replicate' | 'chroma' | 'qdrant' | 'milvus';

export type OpenlitInstrumentations = Partial<Record<InstrumentationType, any>>;

export type PricingObject = Record<string, Record<string, unknown>>;

/**
 *     environment (string): Deployment environment of the application.
 *     applicationName (string): Name of the application using openLIT.
 *     pricingInfo (Object): Pricing information.
 *     tracer (any): Tracer instance for OpenTelemetry.
 *     otlpEndpoint (string): Endpoint for OTLP.
 *     otlpHeaders (Object): Headers for OTLP.
 *     disableBatch (boolean): Flag to disable batch span processing in tracing.
 *     traceContent (boolean): Flag to enable or disable tracing of content.
 */
export interface OpenlitConfigInterface {
  environment?: string;
  applicationName?: string;
  pricingInfo?: PricingObject;
  tracer: NodeTracerProvider;
  otlpEndpoint?: string;
  otlpHeaders?: Record<string, unknown>;
  disableBatch?: boolean;
  traceContent?: boolean;
  pricing_json?: string | PricingObject;
}

export type OpenlitOptions = {
  environment?: OpenlitConfigInterface['environment'];
  applicationName?: OpenlitConfigInterface['applicationName'];
  tracer?: OpenlitConfigInterface['tracer'];
  otlpEndpoint?: OpenlitConfigInterface['otlpEndpoint'];
  otlpHeaders?: OpenlitConfigInterface['otlpHeaders'];
  disableBatch?: OpenlitConfigInterface['disableBatch'];
  traceContent?: OpenlitConfigInterface['traceContent'];
  disabledInstrumentations?: string[];
  instrumentations?: OpenlitInstrumentations;
  pricing_json?: OpenlitConfigInterface['pricing_json'];
};

export type SetupTracerOptions = OpenlitOptions & {
  resource: Resource;
};

export type MeterType = ReturnType<typeof metrics.getMeter>;

export type SetupMetricsOptions = SetupTracerOptions & {
  meter?: MeterType;
  exportIntervalMillis?: number;
  allowConsoleExporterFallback?: boolean;
};

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
