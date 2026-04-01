import { Span, SpanKind, Tracer, context, trace, Attributes } from '@opentelemetry/api';
import OpenlitConfig from '../../config';
import OpenLitHelper, { isFrameworkLlmActive, getFrameworkParentContext } from '../../helpers';
import SemanticConvention from '../../semantic-convention';
import BaseWrapper, { BaseSpanAttributes } from '../base-wrapper';

function spanCreationAttrs(
  operationName: string,
  requestModel: string
): Attributes {
  return {
    [SemanticConvention.GEN_AI_OPERATION]: operationName,
    [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: ReplicateWrapper.aiSystem,
    [SemanticConvention.GEN_AI_REQUEST_MODEL]: requestModel,
    [SemanticConvention.SERVER_ADDRESS]: ReplicateWrapper.serverAddress,
    [SemanticConvention.SERVER_PORT]: ReplicateWrapper.serverPort,
  };
}

class ReplicateWrapper extends BaseWrapper {
  static aiSystem = SemanticConvention.GEN_AI_SYSTEM_REPLICATE;
  static serverAddress = 'api.replicate.com';
  static serverPort = 443;

  static _patchRun(tracer: Tracer): any {
    const genAIEndpoint = 'replicate.run';
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        if (isFrameworkLlmActive()) return originalMethod.apply(this, args);
        const identifier = typeof args[0] === 'string' ? args[0] : '';
        const requestModel = identifier.split(':')[0] || identifier;
        const spanName = `${SemanticConvention.GEN_AI_OPERATION_TYPE_TEXT_COMPLETION} ${requestModel}`;
        const effectiveCtx = getFrameworkParentContext() ?? context.active();
        const span = tracer.startSpan(spanName, {
          kind: SpanKind.CLIENT,
          attributes: spanCreationAttrs(SemanticConvention.GEN_AI_OPERATION_TYPE_TEXT_COMPLETION, requestModel),
        }, effectiveCtx);
        return context
          .with(trace.setSpan(effectiveCtx, span), async () => {
            return originalMethod.apply(this, args);
          })
          .then((response: any) => ReplicateWrapper._run({ args, genAIEndpoint, response, span }))
          .catch((e: any) => {
            OpenLitHelper.handleException(span, e);
            BaseWrapper.recordMetrics(span, {
              genAIEndpoint,
              model: requestModel,
              aiSystem: ReplicateWrapper.aiSystem,
              serverAddress: ReplicateWrapper.serverAddress,
              serverPort: ReplicateWrapper.serverPort,
              errorType: e?.constructor?.name || '_OTHER',
            });
            span.end();
            throw e;
          });
      };
    };
  }

  static async _run({
    args,
    genAIEndpoint,
    response,
    span,
  }: {
    args: any[];
    genAIEndpoint: string;
    response: any;
    span: Span;
  }): Promise<any> {
    let metricParams: BaseSpanAttributes | undefined;
    try {
      const captureContent = OpenlitConfig.captureMessageContent;

      const identifier = typeof args[0] === 'string' ? args[0] : '';
      const options = args[1] || {};
      const input = options.input || {};
      const prompt: string = input.prompt || '';
      const requestModel = identifier.split(':')[0] || identifier;

      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, false);

      let outputText = '';
      let outputType = SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT;

      if (typeof response === 'string') {
        outputText = response;
      } else if (Array.isArray(response)) {
        outputText = response.join('');
      } else if (response && typeof response === 'object') {
        outputType = SemanticConvention.GEN_AI_OUTPUT_TYPE_JSON;
        outputText = JSON.stringify(response);
      }

      span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, outputType);

      const promptTokens = OpenLitHelper.generalTokens(prompt) ?? 0;
      const completionTokens = OpenLitHelper.generalTokens(outputText) ?? 0;

      const pricingInfo = OpenlitConfig.pricingInfo || {};
      const cost = OpenLitHelper.getChatModelCost(requestModel, pricingInfo, promptTokens, completionTokens);

      ReplicateWrapper.setBaseSpanAttributes(span, {
        genAIEndpoint,
        model: requestModel,
        cost,
        aiSystem: ReplicateWrapper.aiSystem,
        serverAddress: ReplicateWrapper.serverAddress,
        serverPort: ReplicateWrapper.serverPort,
      });

      span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, requestModel);
      span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, promptTokens);
      span.setAttribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, completionTokens);
      span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, ['stop']);

      let inputMessagesJson: string | undefined;
      let outputMessagesJson: string | undefined;
      if (captureContent) {
        const messages = prompt ? [{ role: 'user', content: prompt }] : [];
        inputMessagesJson = OpenLitHelper.buildInputMessages(messages);
        span.setAttribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, inputMessagesJson);
        outputMessagesJson = OpenLitHelper.buildOutputMessages(outputText, 'stop');
        span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_MESSAGES, outputMessagesJson);
      }

      if (!OpenlitConfig.disableEvents) {
        const eventAttrs: Attributes = {
          [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_TEXT_COMPLETION,
          [SemanticConvention.GEN_AI_REQUEST_MODEL]: requestModel,
          [SemanticConvention.GEN_AI_RESPONSE_MODEL]: requestModel,
          [SemanticConvention.SERVER_ADDRESS]: ReplicateWrapper.serverAddress,
          [SemanticConvention.SERVER_PORT]: ReplicateWrapper.serverPort,
          [SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON]: ['stop'],
          [SemanticConvention.GEN_AI_OUTPUT_TYPE]: outputType,
          [SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS]: promptTokens,
          [SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS]: completionTokens,
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
        aiSystem: ReplicateWrapper.aiSystem,
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

export default ReplicateWrapper;
