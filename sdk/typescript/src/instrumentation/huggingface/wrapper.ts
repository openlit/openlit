import { Span, SpanKind, Tracer, context, trace } from '@opentelemetry/api';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import SemanticConvention from '../../semantic-convention';
import BaseWrapper from '../base-wrapper';

class HuggingFaceWrapper extends BaseWrapper {
  static aiSystem = SemanticConvention.GEN_AI_SYSTEM_HUGGING_FACE;
  static serverAddress = 'api-inference.huggingface.co';
  static serverPort = 443;

  static _patchChatCompletion(tracer: Tracer): any {
    const genAIEndpoint = 'huggingface.chat.completions';
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const span = tracer.startSpan(genAIEndpoint, { kind: SpanKind.CLIENT });
        return context
          .with(trace.setSpan(context.active(), span), async () => {
            return originalMethod.apply(this, args);
          })
          .then((response: any) => {
            const { stream = false } = args[0] || {};
            if (stream) {
              return OpenLitHelper.createStreamProxy(
                response,
                HuggingFaceWrapper._chatCompletionGenerator({ args, genAIEndpoint, response, span })
              );
            }
            return HuggingFaceWrapper._chatCompletion({ args, genAIEndpoint, response, span });
          })
          .catch((e: any) => {
            OpenLitHelper.handleException(span, e);
            span.end();
            throw e;
          });
      };
    };
  }

  static async _chatCompletion({
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
      metricParams = await HuggingFaceWrapper._chatCompletionCommonSetter({
        args,
        genAIEndpoint,
        result: response,
        span,
      });
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

  static async *_chatCompletionGenerator({
    args,
    genAIEndpoint,
    response,
    span,
  }: {
    args: any[];
    genAIEndpoint: string;
    response: any;
    span: Span;
  }): AsyncGenerator<unknown, any, unknown> {
    let metricParams;
    const timestamps: number[] = [];
    const startTime = Date.now();

    try {
      const { messages } = args[0] || {};
      const result = {
        id: '0',
        created: -1,
        model: args[0]?.model || '',
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: { role: 'assistant', content: '' },
          },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      };

      for await (const chunk of response) {
        timestamps.push(Date.now());
        if (chunk.id) result.id = chunk.id;
        if (chunk.created) result.created = chunk.created;
        if (chunk.model) result.model = chunk.model;
        if (chunk.choices?.[0]?.finish_reason) {
          result.choices[0].finish_reason = chunk.choices[0].finish_reason;
        }
        if (chunk.choices?.[0]?.delta?.content) {
          result.choices[0].message.content += chunk.choices[0].delta.content;
        }
        yield chunk;
      }

      let promptTokens = 0;
      for (const message of messages || []) {
        promptTokens += OpenLitHelper.generalTokens(message.content as string) ?? 0;
      }
      const completionTokens = OpenLitHelper.generalTokens(result.choices[0].message.content ?? '');
      if (completionTokens) {
        result.usage = {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
        };
      }

      const ttft = timestamps.length > 0 ? (timestamps[0] - startTime) / 1000 : 0;
      let tbt = 0;
      if (timestamps.length > 1) {
        const timeDiffs = timestamps.slice(1).map((t, i) => t - timestamps[i]);
        tbt = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length / 1000;
      }

      metricParams = await HuggingFaceWrapper._chatCompletionCommonSetter({
        args,
        genAIEndpoint,
        result,
        span,
        ttft,
        tbt,
      });

      return result;
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

  static async _chatCompletionCommonSetter({
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
      model,
      max_tokens = null,
      temperature = 1,
      top_p,
      stream = false,
    } = args[0] || {};

    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_P, top_p || 1);
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, max_tokens || -1);
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, temperature);
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, stream);

    if (traceContent) {
      span.setAttribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, OpenLitHelper.buildInputMessages(messages || []));
    }

    span.setAttribute(SemanticConvention.GEN_AI_OPERATION, SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT);

    if (result.id) span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_ID, result.id);

    const responseModel = result.model || model || '';
    const pricingInfo = await OpenlitConfig.updatePricingJson(OpenlitConfig.pricing_json);
    const cost = OpenLitHelper.getChatModelCost(
      responseModel,
      pricingInfo,
      result.usage?.prompt_tokens || 0,
      result.usage?.completion_tokens || 0
    );

    HuggingFaceWrapper.setBaseSpanAttributes(span, {
      genAIEndpoint,
      model: responseModel,
      cost,
      aiSystem: HuggingFaceWrapper.aiSystem,
      serverAddress: HuggingFaceWrapper.serverAddress,
      serverPort: HuggingFaceWrapper.serverPort,
    });

    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, responseModel);
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, result.usage?.prompt_tokens || 0);
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, result.usage?.completion_tokens || 0);
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS, result.usage?.total_tokens || 0);
    span.setAttribute(SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE, result.usage?.total_tokens || 0);

    if (ttft > 0) span.setAttribute(SemanticConvention.GEN_AI_SERVER_TTFT, ttft);
    if (tbt > 0) span.setAttribute(SemanticConvention.GEN_AI_SERVER_TBT, tbt);

    if (result.choices?.[0]?.finish_reason) {
      span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, [result.choices[0].finish_reason]);
    }
    span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT);

    if (traceContent && result.choices?.[0]?.message) {
      span.setAttribute(
        SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
        OpenLitHelper.buildOutputMessages(
          result.choices[0].message.content || '',
          result.choices[0].finish_reason || 'stop'
        )
      );
    }

    return { genAIEndpoint, model: responseModel, cost, aiSystem: HuggingFaceWrapper.aiSystem };
  }

  // ── Text Generation ──────────────────────────────────────────────────────────

  static _patchTextGeneration(tracer: Tracer): any {
    const genAIEndpoint = 'huggingface.text.generation';
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const span = tracer.startSpan(genAIEndpoint, { kind: SpanKind.CLIENT });
        return context
          .with(trace.setSpan(context.active(), span), async () => {
            return originalMethod.apply(this, args);
          })
          .then((response: any) =>
            HuggingFaceWrapper._textGeneration({ args, genAIEndpoint, response, span })
          )
          .catch((e: any) => {
            OpenLitHelper.handleException(span, e);
            span.end();
            throw e;
          });
      };
    };
  }

  static async _textGeneration({
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
      const { model = '', inputs = '', parameters = {} } = args[0] || {};
      const { max_new_tokens = null, temperature = 1 } = parameters;

      span.setAttribute(SemanticConvention.GEN_AI_OPERATION, SemanticConvention.GEN_AI_OPERATION_TYPE_TEXT_COMPLETION);
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, max_new_tokens || -1);
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, temperature);
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, false);

      if (traceContent) {
        span.setAttribute(SemanticConvention.GEN_AI_CONTENT_PROMPT_EVENT, inputs);
      }

      const generatedText: string = response?.generated_text || '';
      const promptTokens = OpenLitHelper.generalTokens(inputs) ?? 0;
      const completionTokens = OpenLitHelper.generalTokens(generatedText) ?? 0;

      const pricingInfo = await OpenlitConfig.updatePricingJson(OpenlitConfig.pricing_json);
      const cost = OpenLitHelper.getChatModelCost(model, pricingInfo, promptTokens, completionTokens);

      HuggingFaceWrapper.setBaseSpanAttributes(span, {
        genAIEndpoint,
        model,
        cost,
        aiSystem: HuggingFaceWrapper.aiSystem,
        serverAddress: HuggingFaceWrapper.serverAddress,
        serverPort: HuggingFaceWrapper.serverPort,
      });

      span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, promptTokens);
      span.setAttribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, completionTokens);
      span.setAttribute(SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS, promptTokens + completionTokens);
      span.setAttribute(SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE, promptTokens + completionTokens);
      span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT);

      if (traceContent) {
        span.setAttribute(SemanticConvention.GEN_AI_CONTENT_COMPLETION_EVENT, generatedText);
      }

      metricParams = { genAIEndpoint, model, cost, aiSystem: HuggingFaceWrapper.aiSystem };
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

export default HuggingFaceWrapper;
