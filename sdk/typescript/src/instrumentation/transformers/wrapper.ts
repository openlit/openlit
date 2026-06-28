import { Span, SpanKind, Tracer, context, trace, Attributes } from '@opentelemetry/api';
import OpenlitConfig from '../../config';
import OpenLitHelper, {
  isFrameworkLlmActive,
  getFrameworkParentContext,
  getCurrentAgentVersion,
} from '../../helpers';
import SemanticConvention from '../../semantic-convention';
import BaseWrapper, { BaseSpanAttributes } from '../base-wrapper';

function spanCreationAttrs(
  operationName: string,
  requestModel: string
): Attributes {
  return {
    [SemanticConvention.GEN_AI_OPERATION]: operationName,
    [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: SemanticConvention.GEN_AI_SYSTEM_HUGGING_FACE,
    [SemanticConvention.GEN_AI_REQUEST_MODEL]: requestModel,
    [SemanticConvention.SERVER_ADDRESS]: TransformersWrapper.serverAddress,
    [SemanticConvention.SERVER_PORT]: TransformersWrapper.serverPort,
  };
}

/**
 * Resolves the model identifier from a pipeline instance.
 * Tries multiple known locations across SDK versions.
 */
function resolveModel(instance: any): string {
  return (
    instance?.model?.config?.name_or_path ||
    instance?.model?.config?.model_type ||
    instance?.model_id ||
    instance?.task ||
    'unknown'
  );
}

/**
 * Determine the GenAI operation type from the pipeline class name or task.
 */
function resolveOperation(className: string, task?: string): string {
  const taskLower = (task || className || '').toLowerCase();
  if (taskLower.includes('embedding') || taskLower.includes('feature')) {
    return SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING;
  }
  return SemanticConvention.GEN_AI_OPERATION_TYPE_TEXT_COMPLETION;
}

class TransformersWrapper extends BaseWrapper {
  static aiSystem = SemanticConvention.GEN_AI_SYSTEM_HUGGING_FACE;
  static serverAddress = '127.0.0.1';
  static serverPort = 80;

  static _stampAgentVersion(
    span: Span,
    args: {
      primaryModel?: string;
      temperature?: number | null;
      top_p?: number | null;
      max_tokens?: number | null;
    }
  ): Record<string, string> {
    const out: Record<string, string> = {};
    try {
      const versionHash = OpenLitHelper.computeAgentVersionHash({
        systemInstructions: null,
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
   * Patch `Pipeline.prototype._call` (or a subclass).
   * `this` inside the wrapper is the Pipeline instance.
   * args[0] = inputs (string | string[] | object), args[1] = options object
   */
  static _patchPipelineCall(tracer: Tracer, className: string): any {
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        if (isFrameworkLlmActive()) return originalMethod.apply(this, args);

        const requestModel = resolveModel(this);
        const task: string = this.task || '';
        const operationName = resolveOperation(className, task);
        const spanName = `${operationName} ${requestModel}`;
        const effectiveCtx = getFrameworkParentContext() ?? context.active();
        const span = tracer.startSpan(
          spanName,
          {
            kind: SpanKind.CLIENT,
            attributes: spanCreationAttrs(operationName, requestModel),
          },
          effectiveCtx
        );

        return context
          .with(trace.setSpan(effectiveCtx, span), () => originalMethod.apply(this, args))
          .then((response: any) =>
            TransformersWrapper._handleResponse({
              instance: this,
              args,
              response,
              span,
              requestModel,
              operationName,
              genAIEndpoint: `transformers.${task || className.toLowerCase()}`,
            })
          )
          .catch((e: any) => {
            OpenLitHelper.handleException(span, e);
            BaseWrapper.recordMetrics(span, {
              genAIEndpoint: `transformers.${task || className.toLowerCase()}`,
              model: requestModel,
              aiSystem: TransformersWrapper.aiSystem,
              serverAddress: TransformersWrapper.serverAddress,
              serverPort: TransformersWrapper.serverPort,
              errorType: e?.constructor?.name || '_OTHER',
            });
            span.end();
            throw e;
          });
      };
    };
  }

  /**
   * Patch the `pipeline()` factory as a fallback when no Pipeline class
   * prototype is available. We intercept the returned pipeline function and
   * wrap its invocations.
   */
  static _patchPipelineFactory(tracer: Tracer): any {
    return (originalFactory: (...args: any[]) => any) => {
      return async function (this: any, ...factoryArgs: any[]) {
        const pipe = await originalFactory.apply(this, factoryArgs);
        if (typeof pipe !== 'function') return pipe;

        // Wrap the callable pipeline
        const task: string = factoryArgs[0] || 'pipeline';
        const wrappedPipe: any = async function (...callArgs: any[]) {
          const requestModel =
            resolveModel(pipe) ||
            (typeof factoryArgs[1] === 'string' ? factoryArgs[1] : 'unknown');
          const operationName = resolveOperation('', task);
          const spanName = `${operationName} ${requestModel}`;
          const effectiveCtx = getFrameworkParentContext() ?? context.active();
          const span = tracer.startSpan(
            spanName,
            {
              kind: SpanKind.CLIENT,
              attributes: spanCreationAttrs(operationName, requestModel),
            },
            effectiveCtx
          );

          return context
            .with(trace.setSpan(effectiveCtx, span), () => pipe.apply(undefined, callArgs))
            .then((response: any) =>
              TransformersWrapper._handleResponse({
                instance: pipe,
                args: callArgs,
                response,
                span,
                requestModel,
                operationName,
                genAIEndpoint: `transformers.${task}`,
              })
            )
            .catch((e: any) => {
              OpenLitHelper.handleException(span, e);
              BaseWrapper.recordMetrics(span, {
                genAIEndpoint: `transformers.${task}`,
                model: requestModel,
                aiSystem: TransformersWrapper.aiSystem,
                serverAddress: TransformersWrapper.serverAddress,
                serverPort: TransformersWrapper.serverPort,
                errorType: e?.constructor?.name || '_OTHER',
              });
              span.end();
              throw e;
            });
        };

        // Copy over properties so the wrapped pipe behaves like the original
        Object.assign(wrappedPipe, pipe);
        return wrappedPipe;
      };
    };
  }

  static async _handleResponse({
    instance,
    args,
    response,
    span,
    requestModel,
    operationName,
    genAIEndpoint,
  }: {
    instance: any;
    args: any[];
    response: any;
    span: Span;
    requestModel: string;
    operationName: string;
    genAIEndpoint: string;
  }): Promise<any> {
    let metricParams: BaseSpanAttributes | undefined;
    try {
      const captureContent = OpenlitConfig.captureMessageContent;
      const inputs = args[0];
      const options: any = args[1] || {};
      const maxNewTokens: number | null =
        options.max_new_tokens ?? options.max_length ?? null;
      const temperature: number = options.temperature ?? 1;
      const topP: number | null = options.top_p ?? null;

      // Extract generated text from various response shapes
      let generatedText = '';
      if (Array.isArray(response)) {
        const first = response[0];
        if (typeof first === 'object' && first !== null) {
          generatedText =
            first.generated_text ||
            first.translation_text ||
            first.summary_text ||
            first.answer ||
            first.label ||
            JSON.stringify(first);
        } else {
          generatedText = String(first ?? '');
        }
      } else if (typeof response === 'object' && response !== null) {
        generatedText =
          (response as any).generated_text ||
          (response as any).translation_text ||
          JSON.stringify(response);
      } else {
        generatedText = String(response ?? '');
      }

      const inputStr =
        typeof inputs === 'string'
          ? inputs
          : Array.isArray(inputs)
          ? inputs.join('\n')
          : JSON.stringify(inputs);

      const promptTokens = OpenLitHelper.generalTokens(inputStr) ?? 0;
      const completionTokens = OpenLitHelper.generalTokens(generatedText) ?? 0;

      const pricingInfo = OpenlitConfig.pricingInfo || {};
      const cost = OpenLitHelper.getChatModelCost(
        requestModel,
        pricingInfo,
        promptTokens,
        completionTokens
      );

      TransformersWrapper.setBaseSpanAttributes(span, {
        genAIEndpoint,
        model: requestModel,
        cost,
        aiSystem: TransformersWrapper.aiSystem,
        serverAddress: TransformersWrapper.serverAddress,
        serverPort: TransformersWrapper.serverPort,
      });

      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, temperature);
      if (maxNewTokens !== null) {
        span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, maxNewTokens);
      }
      if (topP !== null) {
        span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_P, topP);
      }
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, false);
      span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, requestModel);
      span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, promptTokens);
      span.setAttribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, completionTokens);
      span.setAttribute(
        SemanticConvention.GEN_AI_OUTPUT_TYPE,
        SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT
      );
      span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, ['stop']);

      const versionExtras = TransformersWrapper._stampAgentVersion(span, {
        primaryModel: requestModel,
        temperature,
        top_p: topP,
        max_tokens: maxNewTokens,
      });

      let inputMessagesJson: string | undefined;
      let outputMessagesJson: string | undefined;
      if (captureContent) {
        inputMessagesJson = OpenLitHelper.buildInputMessages([{ role: 'user', content: inputStr }]);
        span.setAttribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, inputMessagesJson);
        outputMessagesJson = OpenLitHelper.buildOutputMessages(generatedText, 'stop');
        span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_MESSAGES, outputMessagesJson);
      }

      if (!OpenlitConfig.disableEvents) {
        const eventAttrs: Attributes = {
          [SemanticConvention.GEN_AI_OPERATION]: operationName,
          [SemanticConvention.GEN_AI_REQUEST_MODEL]: requestModel,
          [SemanticConvention.GEN_AI_RESPONSE_MODEL]: requestModel,
          [SemanticConvention.SERVER_ADDRESS]: TransformersWrapper.serverAddress,
          [SemanticConvention.SERVER_PORT]: TransformersWrapper.serverPort,
          [SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON]: ['stop'],
          [SemanticConvention.GEN_AI_OUTPUT_TYPE]: SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT,
          [SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS]: promptTokens,
          [SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS]: completionTokens,
          ...versionExtras,
        };
        if (captureContent) {
          if (inputMessagesJson) eventAttrs[SemanticConvention.GEN_AI_INPUT_MESSAGES] = inputMessagesJson;
          if (outputMessagesJson) eventAttrs[SemanticConvention.GEN_AI_OUTPUT_MESSAGES] = outputMessagesJson;
        }
        OpenLitHelper.emitInferenceEvent(span, eventAttrs);
      }

      metricParams = {
        genAIEndpoint,
        model: requestModel,
        cost,
        aiSystem: TransformersWrapper.aiSystem,
        serverAddress: TransformersWrapper.serverAddress,
        serverPort: TransformersWrapper.serverPort,
      };

      return response;
    } catch (e: any) {
      OpenLitHelper.handleException(span, e);
      throw e;
    } finally {
      span.end();
      if (metricParams) {
        BaseWrapper.recordMetrics(span, metricParams);
      }
    }
  }
}

export default TransformersWrapper;
