import { Span, SpanKind, Tracer, context, trace } from '@opentelemetry/api';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import SemanticConvention from '../../semantic-convention';
import BaseWrapper, { BaseSpanAttributes } from '../base-wrapper';

export default class AnthropicWrapper extends BaseWrapper {
  static aiSystem = SemanticConvention.GEN_AI_SYSTEM_ANTHROPIC;
  static serverAddress = 'api.anthropic.com';
  static serverPort = 443;

  static _patchMessageCreate(tracer: Tracer): any {
    const genAIEndpoint = 'anthropic.resources.messages';
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
                AnthropicWrapper._messageCreateGenerator({
                  args,
                  genAIEndpoint,
                  response,
                  span,
                })
              );
            }

            return AnthropicWrapper._messageCreate({ args, genAIEndpoint, response, span });
          })
          .catch((e: any) => {
            OpenLitHelper.handleException(span, e);
            span.end();
            throw e;
          });
      };
    };
  }

  static async _messageCreate({
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
    let metricParams: BaseSpanAttributes = {
      genAIEndpoint,
      model: '',
      user: '',
      cost: 0,
      aiSystem: AnthropicWrapper.aiSystem,
    };
    try {
      metricParams = await AnthropicWrapper._messageCreateCommonSetter({
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
      BaseWrapper.recordMetrics(span, metricParams);
    }
  }

  static async *_messageCreateGenerator({
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
      const result = {
        id: '0',
        model: '',
        stop_reason: '',
        content: [
          {
            text: '',
            role: '',
          },
        ],
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      };
      for await (const chunk of response) {
        timestamps.push(Date.now());
        switch (chunk.type) {
          case 'content_block_delta':
            result.content[0].text += chunk.delta?.text ?? '';
            break;
          case 'message_stop':
            break;

          case 'content_block_stop':
            break;

          case 'message_start':
            if (chunk.message) {
              result.id = chunk.message.id;
              result.model = chunk.message.model;
              result.content[0].role = chunk.message.role;
              result.usage.input_tokens += Number(chunk.message.usage?.input_tokens) ?? 0;
              result.usage.output_tokens += Number(chunk.message.usage?.output_tokens) ?? 0;
              result.usage.cache_creation_input_tokens = Number(chunk.message.usage?.cache_creation_input_tokens) || 0;
              result.usage.cache_read_input_tokens = Number(chunk.message.usage?.cache_read_input_tokens) || 0;
              result.stop_reason = chunk.message?.stop_reason ?? '';
            }
            break;

          case 'content_block_start':
            result.content[0].text = chunk.content_block?.text ?? '';
            break;
          case 'message_delta':
            result.stop_reason = chunk.delta?.stop_reason ?? '';
            result.usage.output_tokens += Number(chunk.usage?.output_tokens) ?? 0;
            if (chunk.usage?.cache_creation_input_tokens) {
              result.usage.cache_creation_input_tokens = Number(chunk.usage.cache_creation_input_tokens) || 0;
            }
            if (chunk.usage?.cache_read_input_tokens) {
              result.usage.cache_read_input_tokens = Number(chunk.usage.cache_read_input_tokens) || 0;
            }
            break;
        }

        yield chunk;
      }

      result.usage.total_tokens = result.usage.output_tokens + result.usage.input_tokens;

      // Calculate TTFT and TBT
      const ttft = timestamps.length > 0 ? (timestamps[0] - startTime) / 1000 : 0;
      let tbt = 0;
      if (timestamps.length > 1) {
        const timeDiffs = timestamps.slice(1).map((t, i) => t - timestamps[i]);
        tbt = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length / 1000;
      }

      metricParams = await AnthropicWrapper._messageCreateCommonSetter({
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

  static async _messageCreateCommonSetter({
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
      system,
      max_tokens = null,
      seed = null,
      temperature = 1,
      top_p,
      top_k,
      user,
      stream = false,
    } = args[0];

    span.setAttribute(
      SemanticConvention.GEN_AI_OPERATION,
      SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT
    );
    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_ID, result.id);

    const model = result.model || 'claude-3-sonnet-20240229';

    const pricingInfo = await OpenlitConfig.updatePricingJson(OpenlitConfig.pricing_json);

    // Calculate cost of the operation
    const cost = OpenLitHelper.getChatModelCost(
      model,
      pricingInfo,
      result.usage.input_tokens,
      result.usage.output_tokens
    );

    AnthropicWrapper.setBaseSpanAttributes(span, {
      genAIEndpoint,
      model,
      user,
      cost,
      aiSystem: AnthropicWrapper.aiSystem,
      serverAddress: AnthropicWrapper.serverAddress,
      serverPort: AnthropicWrapper.serverPort,
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

    // System instructions
    if (system) {
      const systemStr = typeof system === 'string' ? system : JSON.stringify(system);
      span.setAttribute(SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS, systemStr);
    }

    if (traceContent) {
      span.setAttribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, OpenLitHelper.buildInputMessages(messages || []));
    }
    // Request Params attributes : End

    span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, result.usage.input_tokens);
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, result.usage.output_tokens);
    span.setAttribute(
      SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS,
      result.usage.input_tokens + result.usage.output_tokens
    );
    span.setAttribute(SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE, result.usage.input_tokens + result.usage.output_tokens);

    // Cache token attributes (Anthropic prompt caching)
    if (result.usage.cache_creation_input_tokens) {
      span.setAttribute(
        SemanticConvention.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS,
        result.usage.cache_creation_input_tokens
      );
    }
    if (result.usage.cache_read_input_tokens) {
      span.setAttribute(
        SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS,
        result.usage.cache_read_input_tokens
      );
    }

    // TTFT and TBT streaming metrics
    if (ttft > 0) {
      span.setAttribute(SemanticConvention.GEN_AI_SERVER_TTFT, ttft);
    }
    if (tbt > 0) {
      span.setAttribute(SemanticConvention.GEN_AI_SERVER_TBT, tbt);
    }

    if (result.stop_reason) {
      span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, [result.stop_reason]);
    }

    // Tool calls from content blocks of type 'tool_use'
    const toolUseBlocks = (result.content || []).filter((b: any) => b.type === 'tool_use');
    if (toolUseBlocks.length > 0) {
      const toolNames = toolUseBlocks.map((b: any) => b.name || '').filter(Boolean);
      const toolIds = toolUseBlocks.map((b: any) => b.id || '').filter(Boolean);
      const toolArgs = toolUseBlocks.map((b: any) => JSON.stringify(b.input || {}));
      if (toolNames.length > 0) span.setAttribute(SemanticConvention.GEN_AI_TOOL_NAME, toolNames.join(', '));
      if (toolIds.length > 0) span.setAttribute(SemanticConvention.GEN_AI_TOOL_CALL_ID, toolIds.join(', '));
      if (toolArgs.length > 0) span.setAttribute(SemanticConvention.GEN_AI_TOOL_CALL_ARGUMENTS, toolArgs);
      span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, SemanticConvention.GEN_AI_OUTPUT_TYPE_JSON);
    } else {
      span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT);
    }

    if (traceContent) {
      const textContent = (result.content || [])
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text || '')
        .join('');
      span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
        OpenLitHelper.buildOutputMessages(textContent, result.stop_reason || 'stop', toolUseBlocks.length > 0 ? toolUseBlocks : undefined));
    }
    return {
      genAIEndpoint,
      model,
      user,
      cost,
      aiSystem: AnthropicWrapper.aiSystem,
      serverAddress: AnthropicWrapper.serverAddress,
      serverPort: AnthropicWrapper.serverPort,
    };
  }
}
