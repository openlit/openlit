import { Span } from '@opentelemetry/api';
import { ATTR_SERVICE_NAME, ATTR_TELEMETRY_SDK_NAME } from '@opentelemetry/semantic-conventions';
import OpenlitConfig from '../../config';
import { SDK_NAME } from '../../constant';
import OpenLitHelper, { applyCustomSpanAttributes } from '../../helpers';
import SemanticConvention from '../../semantic-convention';

export const DEFAULT_MODEL = 'gpt-4o';
export const DEFAULT_SERVER_ADDRESS = 'api.letta.com';
export const DEFAULT_SERVER_PORT = 443;

/**
 * Operation type per Letta method name. Mirrors OPERATION_TYPE_MAP in the Python
 * reference (sdk/python/src/openlit/instrumentation/letta/utils.py). The type is
 * keyed on the method suffix so identical calls emit identical telemetry in both
 * SDKs. Anything unmapped falls back to `workflow`.
 */
export const OPERATION_TYPE_MAP: Record<string, string> = {
  create: SemanticConvention.GEN_AI_OPERATION_TYPE_CREATE_AGENT,
  retrieve: SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
  modify: SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
  delete: SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
  list: SemanticConvention.GEN_AI_OPERATION_TYPE_WORKFLOW,
  create_stream: SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
  create_message: SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
  create_async: SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
  cancel: SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
  reset: SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
  attach: SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS,
  detach: SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS,
};

export function getOperationType(endpoint: string): string {
  const method = endpoint.split('.').pop() || 'unknown';
  return OPERATION_TYPE_MAP[method] ?? SemanticConvention.GEN_AI_OPERATION_TYPE_WORKFLOW;
}

/** Resolve the model name from response / request in the same priority order as Python. */
function resolveModel(response: any, body: any): string {
  if (response?.llm_config?.model) return response.llm_config.model;
  if (body?.model) return body.model;
  return DEFAULT_MODEL;
}

/**
 * Span name generation ported from Python's get_span_name. The span name is built
 * before the call runs, so it uses only the request: chat spans follow the
 * provider pattern `chat {model}`; agent spans use `{operation} {agent_name}`;
 * workflow/tool spans use the method suffix.
 */
export function getSpanName(operationType: string, endpoint: string, instance?: any, body?: any): string {
  const method = endpoint.split('.').pop() || 'unknown';

  if (operationType === SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT) {
    return `chat ${body?.model || DEFAULT_MODEL}`;
  }

  if (
    operationType === SemanticConvention.GEN_AI_OPERATION_TYPE_CREATE_AGENT ||
    operationType === SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT
  ) {
    let agentName = 'agent';
    if (body?.name) agentName = body.name;
    else if (body?.slug) agentName = body.slug;
    else if (instance?.name) agentName = instance.name;
    else if (instance?.slug) agentName = instance.slug;
    else if (body?.agent_id) agentName = `agent-${String(body.agent_id).slice(0, 8)}`;

    if (agentName && agentName !== 'agent') {
      agentName = agentName.replace(/ /g, '_').replace(/-/g, '_').toLowerCase();
      if (agentName.length > 20) agentName = agentName.slice(0, 20);
    }
    return `${operationType} ${agentName}`;
  }

  if (operationType === SemanticConvention.GEN_AI_OPERATION_TYPE_WORKFLOW) {
    return `workflow ${method}`;
  }

  if (operationType === SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS) {
    return `tool ${method}`;
  }

  return `${operationType} ${method}`;
}

function truncateContent(content: string): string {
  const limit = OpenlitConfig.maxContentLength;
  if (typeof limit === 'number' && limit > 0 && content.length > limit) {
    return content.slice(0, limit);
  }
  return content;
}

function resolveServerInfo(instance: any): [string, number] {
  let baseUrl: string | undefined;
  if (instance) {
    baseUrl =
      instance._client?.baseURL ??
      instance._client_wrapper?._base_url ??
      instance._client?.base_url ??
      instance.baseURL ??
      instance.base_url ??
      instance._base_url;
  }
  if (baseUrl) {
    try {
      const parsed = new URL(String(baseUrl));
      if (parsed.hostname) {
        const port = parsed.port
          ? Number(parsed.port)
          : parsed.protocol === 'https:'
            ? 443
            : 80;
        return [parsed.hostname, port];
      }
    } catch {
      /* ignore malformed base url */
    }
  }
  return [DEFAULT_SERVER_ADDRESS, DEFAULT_SERVER_PORT];
}

function setLlmConfigAttributes(span: Span, llmConfig: any): void {
  if (!llmConfig) return;
  if (llmConfig.model) span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MODEL, llmConfig.model);
  if (llmConfig.provider_name) {
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_PROVIDER, llmConfig.provider_name);
  }
  if (llmConfig.model_endpoint) {
    span.setAttribute(SemanticConvention.GEN_AI_ENDPOINT, llmConfig.model_endpoint);
  }
  if (llmConfig.temperature != null) {
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, llmConfig.temperature);
  }
  if (llmConfig.max_tokens != null) {
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, llmConfig.max_tokens);
  }
  if (llmConfig.frequency_penalty != null) {
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY, llmConfig.frequency_penalty);
  }
  if (llmConfig.context_window != null) {
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_CONTEXT_WINDOW, llmConfig.context_window);
  }
  if (llmConfig.enable_reasoner != null) {
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_ENABLE_REASONER, llmConfig.enable_reasoner);
  }
  if (llmConfig.reasoning_effort != null) {
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_REASONING_EFFORT, llmConfig.reasoning_effort);
  }
  if (llmConfig.max_reasoning_tokens != null) {
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_REASONING_TOKENS, llmConfig.max_reasoning_tokens);
  }
  if (llmConfig.handle != null) {
    span.setAttribute(SemanticConvention.GEN_AI_MODEL_HANDLE, llmConfig.handle);
  }
}

function setUsageAttributes(span: Span, usage: any): void {
  if (!usage) return;
  if (usage.prompt_tokens != null) {
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, usage.prompt_tokens);
  }
  if (usage.completion_tokens != null) {
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, usage.completion_tokens);
  }
  if (usage.total_tokens != null) {
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS, usage.total_tokens);
  }
  if (usage.step_count != null) {
    span.setAttribute(SemanticConvention.GEN_AI_AGENT_STEP_COUNT, usage.step_count);
  }
  if (usage.run_ids != null) {
    span.setAttribute(SemanticConvention.GEN_AI_RUN_ID, String(usage.run_ids));
  }
  if (usage.steps_messages != null) {
    span.setAttribute(SemanticConvention.GEN_AI_AGENT_STEP_MESSAGES, JSON.stringify(usage.steps_messages));
  }
}

function setRequestAttributes(span: Span, body: any, operationType: string): void {
  if (!body || typeof body !== 'object') return;
  if (body.model != null) span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MODEL, String(body.model));
  if (body.temperature != null) {
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, body.temperature);
  }
  if (body.max_tokens != null) {
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, body.max_tokens);
  }
  if (body.frequency_penalty != null) {
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY, body.frequency_penalty);
  }
  if (body.stream != null) span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, body.stream);
  else if (body.streaming != null) {
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, body.streaming);
  }
  if (body.run_async != null) span.setAttribute(SemanticConvention.GEN_AI_REQUEST_ASYNC, body.run_async);
  if (body.return_message_sequence_no != null) {
    span.setAttribute(
      SemanticConvention.GEN_AI_REQUEST_RETURN_SEQUENCE_NO,
      body.return_message_sequence_no
    );
  }
  if (body.include_final_message != null) {
    span.setAttribute(
      SemanticConvention.GEN_AI_REQUEST_INCLUDE_FINAL_MESSAGE,
      body.include_final_message
    );
  }
  if (operationType === SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT && Array.isArray(body.messages)) {
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MESSAGE_COUNT, body.messages.length);
  }
}

function setLettaSpecificAttributes(
  span: Span,
  body: any,
  response: any,
  operationType: string,
  agentId?: string
): void {
  let resolvedAgentId = agentId;
  if (!resolvedAgentId && body?.agent_id) resolvedAgentId = String(body.agent_id);
  else if (!resolvedAgentId && response?.id) resolvedAgentId = String(response.id);
  if (resolvedAgentId) span.setAttribute(SemanticConvention.GEN_AI_AGENT_ID, resolvedAgentId);

  if (response) {
    if (response.name != null) span.setAttribute(SemanticConvention.GEN_AI_AGENT_NAME, String(response.name));
    if (response.slug != null) span.setAttribute(SemanticConvention.GEN_AI_AGENT_SLUG, String(response.slug));
    if (response.description != null) {
      span.setAttribute(SemanticConvention.GEN_AI_AGENT_DESCRIPTION, String(response.description));
    }
    if (response.agent_type != null) {
      span.setAttribute(SemanticConvention.GEN_AI_AGENT_TYPE, response.agent_type);
    }
    if (response.system != null) {
      span.setAttribute(SemanticConvention.GEN_AI_AGENT_INSTRUCTIONS, truncateContent(String(response.system)));
    }
    if (response.llm_config) setLlmConfigAttributes(span, response.llm_config);
    if (operationType === SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT && response.usage) {
      setUsageAttributes(span, response.usage);
    }
  }

  setRequestAttributes(span, body, operationType);

  if (body?.name != null) span.setAttribute(SemanticConvention.GEN_AI_AGENT_NAME, String(body.name));
  if (body?.slug != null) span.setAttribute(SemanticConvention.GEN_AI_AGENT_SLUG, String(body.slug));
}

function serializeContent(value: any): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function setContentAttributes(span: Span, body: any, response: any): void {
  if (body?.messages != null) {
    span.setAttribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, serializeContent(body.messages));
  }
  if (response?.messages != null) {
    span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_MESSAGES, serializeContent(response.messages));
  }
}

function calculateCost(span: Span, response: any, model: string): void {
  const pricingInfo = OpenlitConfig.pricingInfo;
  if (!pricingInfo || !response) return;

  let usage = response.usage;
  if (!usage && Array.isArray(response)) {
    for (let i = response.length - 1; i >= 0; i -= 1) {
      if (response[i]?.message_type === 'usage_statistics') {
        usage = response[i];
        break;
      }
    }
  }
  if (usage && usage.prompt_tokens != null && usage.completion_tokens != null) {
    const actualModel = response.llm_config?.model || model;
    const cost = OpenLitHelper.getChatModelCost(
      actualModel,
      pricingInfo,
      usage.prompt_tokens,
      usage.completion_tokens
    );
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_COST, cost);
  }
}

/**
 * Sets the common framework + Letta-specific attributes on a span. Mirrors
 * process_letta_response + common_framework_span_attributes in the Python reference.
 */
export function processLettaResponse(
  span: Span,
  response: any,
  body: any,
  operationType: string,
  instance: any,
  durationSeconds: number,
  sdkVersion: string,
  agentId?: string
): void {
  const model = resolveModel(response, body);
  const [serverAddress, serverPort] = resolveServerInfo(instance);

  span.setAttribute(ATTR_TELEMETRY_SDK_NAME, SDK_NAME);
  span.setAttribute(SemanticConvention.GEN_AI_SDK_VERSION, sdkVersion);
  span.setAttribute(SemanticConvention.GEN_AI_PROVIDER_NAME, SemanticConvention.GEN_AI_SYSTEM_LETTA);
  span.setAttribute(SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL, SemanticConvention.GEN_AI_SYSTEM_LETTA);
  span.setAttribute(SemanticConvention.GEN_AI_OPERATION, operationType);
  span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MODEL, model);
  span.setAttribute(SemanticConvention.SERVER_ADDRESS, serverAddress);
  span.setAttribute(SemanticConvention.SERVER_PORT, serverPort);
  span.setAttribute(SemanticConvention.ATTR_DEPLOYMENT_ENVIRONMENT, OpenlitConfig.environment || '');
  span.setAttribute(ATTR_SERVICE_NAME, OpenlitConfig.applicationName || '');
  span.setAttribute(SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION, durationSeconds);

  setLettaSpecificAttributes(span, body, response, operationType, agentId);

  if (operationType === SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT && OpenlitConfig.captureMessageContent) {
    setContentAttributes(span, body, response);
  }

  if (operationType === SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT) {
    calculateCost(span, response, model);
  }

  applyCustomSpanAttributes(span);
}
