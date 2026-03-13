import { Span, SpanKind, Tracer, context, trace } from '@opentelemetry/api';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import SemanticConvention from '../../semantic-convention';
import BaseWrapper, { BaseSpanAttributes } from '../base-wrapper';

export default class OllamaWrapper extends BaseWrapper {
  static aiSystem = 'ollama';
  static serverAddress = '127.0.0.1';
  static serverPort = 11434;

  static _patchChat(tracer: Tracer): any {
    const genAIEndpoint = 'ollama.chat';
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const span = tracer.startSpan(genAIEndpoint, { kind: SpanKind.CLIENT });
        const { stream = false } = args[0];
        return context
          .with(trace.setSpan(context.active(), span), async () => {
            return originalMethod.apply(this, args);
          })
          .then((response: any) => {
            if (!!stream) {
              return OpenLitHelper.createStreamProxy(
                response,
                OllamaWrapper._chatGenerator({
                  args,
                  genAIEndpoint,
                  response,
                  span,
                })
              );
            }

            return OllamaWrapper._chat({ args, genAIEndpoint, response, span });
          })
          .catch((e: any) => {
            OpenLitHelper.handleException(span, e);
            span.end();
            throw e;
          });
      };
    };
  }

  static async _chat({
    args,
    genAIEndpoint,
    response,
    span,
  }: {
    args: any[];
    genAIEndpoint: string;
    response: any;
    span: Span;
  }) {
    let metricParams: BaseSpanAttributes | undefined;
    try {
      metricParams = await OllamaWrapper._chatCommonSetter({
        args,
        genAIEndpoint,
        result: response,
        span,
      });
      return response;
    } catch (e: any) {
      OpenLitHelper.handleException(span, e);
    } finally {
      span.end();
      if (metricParams) {
        BaseWrapper.recordMetrics(span, metricParams);
      }
    }
  }

  static async *_chatGenerator({
    args,
    genAIEndpoint,
    response,
    span,
  }: {
    args: any[];
    genAIEndpoint: string;
    response: any;
    span: Span;
  }) {
    let metricParams: BaseSpanAttributes | undefined;
    const timestamps: number[] = [];
    const startTime = Date.now();
    try {
      const result: any = {
        model: '',
        message: { role: 'assistant', content: '' },
        done_reason: '',
        prompt_eval_count: 0,
        eval_count: 0,
      };

      for await (const chunk of response) {
        timestamps.push(Date.now());
        result.model = chunk.model || result.model;
        if (chunk.message?.content) {
          result.message.content += chunk.message.content;
          result.message.role = chunk.message.role || result.message.role;
        }
        if (chunk.done) {
          result.done_reason = chunk.done_reason || '';
          result.prompt_eval_count = chunk.prompt_eval_count || 0;
          result.eval_count = chunk.eval_count || 0;
        }

        yield chunk;
      }

      const ttft = timestamps.length > 0 ? (timestamps[0] - startTime) / 1000 : 0;
      let tbt = 0;
      if (timestamps.length > 1) {
        const timeDiffs = timestamps.slice(1).map((t, i) => t - timestamps[i]);
        tbt = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length / 1000;
      }

      metricParams = await OllamaWrapper._chatCommonSetter({
        args,
        genAIEndpoint,
        result,
        span,
        ttft,
        tbt,
      });
      return response;
    } catch (e: any) {
      OpenLitHelper.handleException(span, e);
    } finally {
      span.end();
      if (metricParams) {
        BaseWrapper.recordMetrics(span, metricParams);
      }
    }
  }

  static async _chatCommonSetter({
    args,
    genAIEndpoint,
    result,
    span,
    ttft = 0,
    tbt = 0,
  }: {
    args: any[];
    genAIEndpoint: string;
    result: any;
    span: Span;
    ttft?: number;
    tbt?: number;
  }) {
    const traceContent = OpenlitConfig.traceContent;
    const {
      messages,
      max_tokens = null,
      seed = null,
      temperature = 1,
      top_p,
      top_k,
      user,
      stream = false,
    } = args[0];

    span.setAttribute(SemanticConvention.GEN_AI_OPERATION, SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT);
    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_ID, result.id);

    const model = result.model || args[0].model;

    const pricingInfo = await OpenlitConfig.updatePricingJson(OpenlitConfig.pricing_json);

    const promptTokens = result.prompt_eval_count || 0;
    const completionTokens = result.eval_count || 0;
    const totalTokens = promptTokens + completionTokens;

    // Calculate cost of the operation
    const cost = OpenLitHelper.getChatModelCost(model, pricingInfo, promptTokens, completionTokens);

    OllamaWrapper.setBaseSpanAttributes(span, {
      genAIEndpoint,
      model,
      user,
      cost,
      aiSystem: OllamaWrapper.aiSystem,
      serverAddress: OllamaWrapper.serverAddress,
      serverPort: OllamaWrapper.serverPort,
    });

    // Response model
    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, model);

    // Request Params attributes : Start
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_P, top_p);
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_K, top_k);
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, max_tokens);
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, temperature);

    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, stream);
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_SEED, seed);
    if (traceContent) {
      span.setAttribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, OpenLitHelper.buildInputMessages(messages || []));
    }
    // Request Params attributes : End

    span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, promptTokens);
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, completionTokens);
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS, totalTokens);
    span.setAttribute(SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE, totalTokens);

    if (result.done_reason) {
      span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, [result.done_reason]);
    }

    // TTFT and TBT metrics
    if (ttft > 0) {
      span.setAttribute(SemanticConvention.GEN_AI_SERVER_TTFT, ttft);
    }
    if (tbt > 0) {
      span.setAttribute(SemanticConvention.GEN_AI_SERVER_TBT, tbt);
    }

    if (traceContent) {
      const { message = {} } = result;
      span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
        OpenLitHelper.buildOutputMessages(message.content || '', result.done_reason || 'stop'));
    }

    return {
      genAIEndpoint,
      model,
      user,
      cost,
      aiSystem: OllamaWrapper.aiSystem,
    };
  }
}
