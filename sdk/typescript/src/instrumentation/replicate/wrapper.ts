import { Span, SpanKind, Tracer, context, trace } from '@opentelemetry/api';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import SemanticConvention from '../../semantic-convention';
import BaseWrapper from '../base-wrapper';

class ReplicateWrapper extends BaseWrapper {
  static aiSystem = SemanticConvention.GEN_AI_SYSTEM_REPLICATE;
  static serverAddress = 'api.replicate.com';
  static serverPort = 443;

  static _patchRun(tracer: Tracer): any {
    const genAIEndpoint = 'replicate.run';
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const span = tracer.startSpan(genAIEndpoint, { kind: SpanKind.CLIENT });
        return context
          .with(trace.setSpan(context.active(), span), async () => {
            return originalMethod.apply(this, args);
          })
          .then((response: any) => ReplicateWrapper._run({ args, genAIEndpoint, response, span }))
          .catch((e: any) => {
            OpenLitHelper.handleException(span, e);
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
    let metricParams;
    try {
      const traceContent = OpenlitConfig.traceContent;

      // args[0] is the model identifier: "owner/model" or "owner/model:version"
      // args[1] is { input: { prompt, ... }, ... }
      const identifier = typeof args[0] === 'string' ? args[0] : '';
      const options = args[1] || {};
      const input = options.input || {};
      const prompt: string = input.prompt || '';

      // Derive a clean model name from the identifier (strip version hash)
      const model = identifier.split(':')[0] || identifier;

      span.setAttribute(SemanticConvention.GEN_AI_OPERATION, SemanticConvention.GEN_AI_OPERATION_TYPE_TEXT_COMPLETION);
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, false);

      if (traceContent && prompt) {
        span.setAttribute(SemanticConvention.GEN_AI_CONTENT_PROMPT_EVENT, prompt);
      }

      // Determine output type and content
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

      const pricingInfo = await OpenlitConfig.updatePricingJson(OpenlitConfig.pricing_json);
      const cost = OpenLitHelper.getChatModelCost(model, pricingInfo, promptTokens, completionTokens);

      ReplicateWrapper.setBaseSpanAttributes(span, {
        genAIEndpoint,
        model,
        cost,
        aiSystem: ReplicateWrapper.aiSystem,
        serverAddress: ReplicateWrapper.serverAddress,
        serverPort: ReplicateWrapper.serverPort,
      });

      span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, promptTokens);
      span.setAttribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, completionTokens);
      span.setAttribute(SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS, promptTokens + completionTokens);
      span.setAttribute(SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE, promptTokens + completionTokens);

      if (traceContent && outputText) {
        span.setAttribute(SemanticConvention.GEN_AI_CONTENT_COMPLETION_EVENT, outputText);
      }

      metricParams = { genAIEndpoint, model, cost, aiSystem: ReplicateWrapper.aiSystem };
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
