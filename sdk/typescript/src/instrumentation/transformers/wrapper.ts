import { Span, SpanKind, Tracer, context, trace, Attributes } from '@opentelemetry/api';
import OpenlitConfig from '../../config';
import OpenLitHelper, {
  isFrameworkLlmActive,
  getFrameworkParentContext,
  getCurrentAgentVersion,
} from '../../helpers';
import SemanticConvention from '../../semantic-convention';
import BaseWrapper, { BaseSpanAttributes } from '../base-wrapper';

/**
 * Classification of a Transformers.js task into an OTel GenAI operation.
 *
 * Parity note: the Python SDK instruments only `TextGenerationPipeline` and
 * reports it as the `chat` operation. We keep that exact mapping for
 * text-generation and extend the TS SDK to the remaining local pipeline
 * types (Option B) using the closest OTel operation for each.
 */
interface TaskClass {
  operation: string;
  isEmbedding: boolean;
}

const TASK_OPERATION: Record<string, TaskClass> = {
  // Generative chat-style (Python parity)
  'text-generation': { operation: SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT, isEmbedding: false },
  // Sequence-to-sequence / extractive text producers
  'text2text-generation': { operation: SemanticConvention.GEN_AI_OPERATION_TYPE_TEXT_COMPLETION, isEmbedding: false },
  summarization: { operation: SemanticConvention.GEN_AI_OPERATION_TYPE_TEXT_COMPLETION, isEmbedding: false },
  translation: { operation: SemanticConvention.GEN_AI_OPERATION_TYPE_TEXT_COMPLETION, isEmbedding: false },
  'fill-mask': { operation: SemanticConvention.GEN_AI_OPERATION_TYPE_TEXT_COMPLETION, isEmbedding: false },
  'question-answering': { operation: SemanticConvention.GEN_AI_OPERATION_TYPE_TEXT_COMPLETION, isEmbedding: false },
  'text-classification': { operation: SemanticConvention.GEN_AI_OPERATION_TYPE_TEXT_COMPLETION, isEmbedding: false },
  'token-classification': { operation: SemanticConvention.GEN_AI_OPERATION_TYPE_TEXT_COMPLETION, isEmbedding: false },
  'zero-shot-classification': { operation: SemanticConvention.GEN_AI_OPERATION_TYPE_TEXT_COMPLETION, isEmbedding: false },
  // Embedding producers
  'feature-extraction': { operation: SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING, isEmbedding: true },
  'sentence-similarity': { operation: SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING, isEmbedding: true },
};

/** Map a Pipeline subclass name to its canonical Transformers.js task string. */
const CLASS_TASK: Record<string, string> = {
  TextGenerationPipeline: 'text-generation',
  Text2TextGenerationPipeline: 'text2text-generation',
  SummarizationPipeline: 'summarization',
  TranslationPipeline: 'translation',
  FillMaskPipeline: 'fill-mask',
  QuestionAnsweringPipeline: 'question-answering',
  TextClassificationPipeline: 'text-classification',
  TokenClassificationPipeline: 'token-classification',
  ZeroShotClassificationPipeline: 'zero-shot-classification',
  FeatureExtractionPipeline: 'feature-extraction',
};

function resolveTask(instance: any, className: string): string {
  return (
    (typeof instance?.task === 'string' && instance.task) ||
    CLASS_TASK[className] ||
    'text-generation'
  );
}

function classifyTask(task: string): TaskClass {
  return (
    TASK_OPERATION[task] || {
      operation: SemanticConvention.GEN_AI_OPERATION_TYPE_TEXT_COMPLETION,
      isEmbedding: false,
    }
  );
}

/**
 * Resolve the model identifier from a pipeline instance, mirroring Python's
 * `instance.model.config.name_or_path`. HF configs expose the path under a few
 * keys across versions, so we probe the common ones before falling back.
 */
function resolveModel(instance: any): string {
  const config = instance?.model?.config ?? {};
  return (
    config._name_or_path ||
    config.name_or_path ||
    config.model_type ||
    instance?.model?.name_or_path ||
    (typeof instance?.task === 'string' ? instance.task : '') ||
    'unknown'
  );
}

/**
 * Extract the generation parameters for a call, mirroring Python which reads
 * `instance._forward_params` (set at pipeline construction) merged with the
 * call-time options object.
 */
function resolveGenerationParams(instance: any, options: any): {
  temperature: number | null;
  topK: number | null;
  topP: number | null;
  maxTokens: number | null;
} {
  const forward = instance?._forward_params ?? {};
  const opts = options ?? {};
  const pick = (key: string, altKey?: string) =>
    opts[key] ?? (altKey ? opts[altKey] : undefined) ?? forward[key] ?? (altKey ? forward[altKey] : undefined) ?? null;

  return {
    temperature: pick('temperature'),
    topK: pick('top_k'),
    topP: pick('top_p'),
    maxTokens: pick('max_new_tokens', 'max_length'),
  };
}

/**
 * Convert a Transformers.js pipeline result into a flat text string per task,
 * mirroring the task branches in Python's `process_chat_response`.
 */
function extractCompletion(task: string, response: any): string {
  const first = Array.isArray(response) ? response[0] : response;

  const fromEntry = (entry: any): string => {
    if (entry === null || entry === undefined) return '';
    if (typeof entry !== 'object') return String(entry);
    // text-generation may nest a chat-message list under generated_text
    if (Array.isArray(entry.generated_text)) {
      const last = entry.generated_text[entry.generated_text.length - 1];
      return last?.content ?? String(last ?? '');
    }
    return (
      entry.generated_text ??
      entry.summary_text ??
      entry.translation_text ??
      entry.answer ??
      entry.sequence ??
      entry.token_str ??
      entry.label ??
      entry.text ??
      ''
    );
  };

  switch (task) {
    case 'automatic-speech-recognition':
      return typeof response === 'object' && response !== null ? response.text ?? '' : '';
    case 'feature-extraction':
    case 'sentence-similarity':
      return '';
    default: {
      const out = fromEntry(first);
      if (out) return out;
      // Fall back to a stable serialization for unknown shapes.
      try {
        return typeof response === 'string' ? response : JSON.stringify(response);
      } catch {
        return String(response ?? '');
      }
    }
  }
}

function stringifyInputs(inputs: any): string {
  if (typeof inputs === 'string') return inputs;
  if (Array.isArray(inputs)) {
    return inputs
      .map((i) => (typeof i === 'string' ? i : i?.content ?? JSON.stringify(i)))
      .join('\n');
  }
  if (inputs && typeof inputs === 'object') {
    // question-answering style { question, context }
    if (typeof inputs.question === 'string') {
      return inputs.context
        ? `question: ${inputs.question} context: ${inputs.context}`
        : inputs.question;
    }
    try {
      return JSON.stringify(inputs);
    } catch {
      return String(inputs);
    }
  }
  return String(inputs ?? '');
}

class TransformersWrapper extends BaseWrapper {
  static aiSystem = SemanticConvention.GEN_AI_SYSTEM_HUGGING_FACE;
  static serverAddress = '127.0.0.1';
  static serverPort = 80;

  /**
   * Stamp `openlit.agent.version_hash` (auto) and `gen_ai.agent.version`
   * (user override) on the span and return them so the caller can merge them
   * into the inference-event extras.
   */
  static _stampAgentVersion(
    span: Span,
    args: {
      systemInstructionsJson?: string | null;
      primaryModel?: string;
      temperature?: number | null;
      top_p?: number | null;
      max_tokens?: number | null;
    }
  ): Record<string, string> {
    const out: Record<string, string> = {};
    try {
      const versionHash = OpenLitHelper.computeAgentVersionHash({
        systemInstructions: args.systemInstructionsJson ?? null,
        toolDefinitions: null,
        primaryModel: args.primaryModel ?? null,
        runtimeConfig: {
          temperature: args.temperature ?? null,
          top_p: args.top_p ?? null,
          max_tokens: args.max_tokens ?? null,
          provider: SemanticConvention.GEN_AI_SYSTEM_HUGGING_FACE,
        },
        providers: [SemanticConvention.GEN_AI_SYSTEM_HUGGING_FACE],
      });
      if (versionHash) {
        out[SemanticConvention.OPENLIT_AGENT_VERSION_HASH] = versionHash;
        span.setAttribute(SemanticConvention.OPENLIT_AGENT_VERSION_HASH, versionHash);
      }
    } catch {
      /* Hash computation must never fail the wrapped call. */
    }
    const versionLabel = getCurrentAgentVersion();
    if (versionLabel) {
      out[SemanticConvention.GEN_AI_AGENT_VERSION] = versionLabel;
      span.setAttribute(SemanticConvention.GEN_AI_AGENT_VERSION, versionLabel);
    }
    return out;
  }

  /**
   * Patch a Pipeline subclass `_call` (the method invoked when the pipeline
   * object is used as a function). `this` is the pipeline instance.
   * args[0] = inputs, args[1] = generation options.
   */
  static _patchPipelineCall(tracer: Tracer, className: string, sdkVersion?: string): any {
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        if (isFrameworkLlmActive()) return originalMethod.apply(this, args);

        const task = resolveTask(this, className);
        const requestModel = resolveModel(this);
        const { operation } = classifyTask(task);
        const genAIEndpoint = `transformers.${task}`;
        const spanName = `${operation} ${requestModel}`;
        const effectiveCtx = getFrameworkParentContext() ?? context.active();
        const span = tracer.startSpan(
          spanName,
          { kind: SpanKind.CLIENT, attributes: spanCreationAttrs(operation, requestModel) },
          effectiveCtx
        );

        return context.with(trace.setSpan(effectiveCtx, span), async () => {
          let metricParams: BaseSpanAttributes | undefined;
          const startTime = Date.now();
          try {
            const response = await originalMethod.apply(this, args);
            metricParams = TransformersWrapper._handleResponse({
              instance: this,
              args,
              response,
              span,
              requestModel,
              task,
              operation,
              genAIEndpoint,
              ttft: (Date.now() - startTime) / 1000,
              sdkVersion,
            });
            return response;
          } catch (e: any) {
            OpenLitHelper.handleException(span, e);
            BaseWrapper.recordMetrics(span, {
              genAIEndpoint,
              model: requestModel,
              aiSystem: TransformersWrapper.aiSystem,
              serverAddress: TransformersWrapper.serverAddress,
              serverPort: TransformersWrapper.serverPort,
              errorType: e?.constructor?.name || '_OTHER',
            });
            throw e;
          } finally {
            span.end();
            if (metricParams) {
              BaseWrapper.recordMetrics(span, metricParams);
            }
          }
        });
      };
    };
  }

  /**
   * Patch the `pipeline()` factory as a fallback when no Pipeline subclass
   * prototype is exported. Wraps the returned callable so each invocation
   * emits a span. The original callable is invoked directly (not via the
   * wrapper) so we never lose its prototype behavior.
   */
  static _patchPipelineFactory(tracer: Tracer, sdkVersion?: string): any {
    return (originalFactory: (...args: any[]) => any) => {
      return async function (this: any, ...factoryArgs: any[]) {
        const pipe = await originalFactory.apply(this, factoryArgs);
        if (typeof pipe !== 'function') return pipe;

        const task: string =
          (typeof factoryArgs[0] === 'string' && factoryArgs[0]) ||
          (typeof pipe.task === 'string' && pipe.task) ||
          'text-generation';
        const { operation } = classifyTask(task);
        const genAIEndpoint = `transformers.${task}`;

        const wrappedPipe: any = async function (this: any, ...callArgs: any[]) {
          if (isFrameworkLlmActive()) return pipe.apply(this, callArgs);

          const requestModel =
            resolveModel(pipe) ||
            (typeof factoryArgs[1] === 'string' ? factoryArgs[1] : 'unknown');
          const spanName = `${operation} ${requestModel}`;
          const effectiveCtx = getFrameworkParentContext() ?? context.active();
          const span = tracer.startSpan(
            spanName,
            { kind: SpanKind.CLIENT, attributes: spanCreationAttrs(operation, requestModel) },
            effectiveCtx
          );

          return context.with(trace.setSpan(effectiveCtx, span), async () => {
            let metricParams: BaseSpanAttributes | undefined;
            const startTime = Date.now();
            try {
              const response = await pipe.apply(this, callArgs);
              metricParams = TransformersWrapper._handleResponse({
                instance: pipe,
                args: callArgs,
                response,
                span,
                requestModel,
                task,
                operation,
                genAIEndpoint,
                ttft: (Date.now() - startTime) / 1000,
                sdkVersion,
              });
              return response;
            } catch (e: any) {
              OpenLitHelper.handleException(span, e);
              BaseWrapper.recordMetrics(span, {
                genAIEndpoint,
                model: requestModel,
                aiSystem: TransformersWrapper.aiSystem,
                serverAddress: TransformersWrapper.serverAddress,
                serverPort: TransformersWrapper.serverPort,
                errorType: e?.constructor?.name || '_OTHER',
              });
              throw e;
            } finally {
              span.end();
              if (metricParams) {
                BaseWrapper.recordMetrics(span, metricParams);
              }
            }
          });
        };

        // Preserve callable identity so the wrapped pipe behaves like the original.
        Object.setPrototypeOf(wrappedPipe, Object.getPrototypeOf(pipe));
        Object.assign(wrappedPipe, pipe);
        return wrappedPipe;
      };
    };
  }

  /**
   * Synchronous attribute setter shared by the class- and factory-patch paths.
   * Returns the metric params so the caller can record metrics in `finally`.
   */
  static _handleResponse({
    instance,
    args,
    response,
    span,
    requestModel,
    task,
    operation,
    genAIEndpoint,
    ttft,
    sdkVersion,
  }: {
    instance: any;
    args: any[];
    response: any;
    span: Span;
    requestModel: string;
    task: string;
    operation: string;
    genAIEndpoint: string;
    ttft: number;
    sdkVersion?: string;
  }): BaseSpanAttributes {
    const captureContent = OpenlitConfig.captureMessageContent;
    const { isEmbedding } = classifyTask(task);

    const inputs = args[0];
    const options = args[1] || {};
    const { temperature, topK, topP, maxTokens } = resolveGenerationParams(instance, options);

    const inputStr = stringifyInputs(inputs);
    const completion = extractCompletion(task, response);

    const inputTokens = OpenLitHelper.generalTokens(inputStr) ?? 0;
    const outputTokens = isEmbedding ? 0 : OpenLitHelper.generalTokens(completion) ?? 0;

    const pricingInfo = OpenlitConfig.pricingInfo || {};
    const cost = OpenLitHelper.getChatModelCost(requestModel, pricingInfo, inputTokens, outputTokens);

    // Common attributes (telemetry sdk, env, app, request model, cost, server).
    TransformersWrapper.setBaseSpanAttributes(span, {
      genAIEndpoint,
      model: requestModel,
      cost,
      aiSystem: TransformersWrapper.aiSystem,
      serverAddress: TransformersWrapper.serverAddress,
      serverPort: TransformersWrapper.serverPort,
    });

    // Parity: Python stamps gen_ai.system and the transformers package version
    // (setBaseSpanAttributes uses OpenLIT's SDK version).
    span.setAttribute(SemanticConvention.GEN_AI_PROVIDER_NAME, TransformersWrapper.aiSystem);
    if (sdkVersion) {
      span.setAttribute(SemanticConvention.GEN_AI_SDK_VERSION, sdkVersion);
    }

    // Request parameters (only when present, matching Python).
    if (temperature !== null) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, temperature);
    }
    if (topK !== null) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_K, topK);
    }
    if (topP !== null) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_P, topP);
    }
    if (maxTokens !== null) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, maxTokens);
    }
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, false);

    // Response parameters.
    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, requestModel);
    if (!isEmbedding) {
      span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, ['stop']);
      span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT);
    }

    // Tokens, cost, cache (cache stamped as 0 even when unused, like Python).
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, outputTokens);
    span.setAttribute(SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE, inputTokens + outputTokens);
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS, 0);
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS, 0);

    // Timing (Python always sets these; tbt is 0 for non-streaming pipelines).
    span.setAttribute(SemanticConvention.GEN_AI_SERVER_TTFT, ttft);
    span.setAttribute(SemanticConvention.GEN_AI_SERVER_TBT, 0);

    const versionExtras = TransformersWrapper._stampAgentVersion(span, {
      systemInstructionsJson: null,
      primaryModel: requestModel,
      temperature,
      top_p: topP,
      max_tokens: maxTokens,
    });

    let inputMessagesJson: string | undefined;
    let outputMessagesJson: string | undefined;
    if (captureContent) {
      inputMessagesJson = OpenLitHelper.buildInputMessages([{ role: 'user', content: inputStr }]);
      span.setAttribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, inputMessagesJson);
      if (!isEmbedding) {
        outputMessagesJson = OpenLitHelper.buildOutputMessages(completion, 'stop');
        span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_MESSAGES, outputMessagesJson);
      }
    }

    if (!OpenlitConfig.disableEvents) {
      const eventAttrs: Attributes = {
        [SemanticConvention.GEN_AI_OPERATION]: operation,
        [SemanticConvention.GEN_AI_REQUEST_MODEL]: requestModel,
        [SemanticConvention.GEN_AI_RESPONSE_MODEL]: requestModel,
        [SemanticConvention.SERVER_ADDRESS]: TransformersWrapper.serverAddress,
        [SemanticConvention.SERVER_PORT]: TransformersWrapper.serverPort,
        [SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS]: inputTokens,
        [SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS]: outputTokens,
        ...versionExtras,
      };
      if (!isEmbedding) {
        eventAttrs[SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON] = ['stop'];
        eventAttrs[SemanticConvention.GEN_AI_OUTPUT_TYPE] = SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT;
      }
      if (captureContent) {
        if (inputMessagesJson) eventAttrs[SemanticConvention.GEN_AI_INPUT_MESSAGES] = inputMessagesJson;
        if (outputMessagesJson) eventAttrs[SemanticConvention.GEN_AI_OUTPUT_MESSAGES] = outputMessagesJson;
      }
      OpenLitHelper.emitInferenceEvent(span, eventAttrs);
    }

    return {
      genAIEndpoint,
      model: requestModel,
      cost,
      aiSystem: TransformersWrapper.aiSystem,
      serverAddress: TransformersWrapper.serverAddress,
      serverPort: TransformersWrapper.serverPort,
    };
  }
}

function spanCreationAttrs(operationName: string, requestModel: string): Attributes {
  return {
    [SemanticConvention.GEN_AI_OPERATION]: operationName,
    [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: SemanticConvention.GEN_AI_SYSTEM_HUGGING_FACE,
    [SemanticConvention.GEN_AI_REQUEST_MODEL]: requestModel,
    [SemanticConvention.SERVER_ADDRESS]: TransformersWrapper.serverAddress,
    [SemanticConvention.SERVER_PORT]: TransformersWrapper.serverPort,
  };
}

export default TransformersWrapper;
