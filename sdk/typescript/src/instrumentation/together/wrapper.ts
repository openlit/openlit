import { Span, SpanKind, Tracer, context, trace } from '@opentelemetry/api';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import SemanticConvention from '../../semantic-convention';
import BaseWrapper from '../base-wrapper';

class TogetherWrapper extends BaseWrapper {
  static aiSystem = 'together';
  static serverAddress = 'api.together.xyz';
  static serverPort = 443;
  
  static _patchChatCompletionCreate(tracer: Tracer): any {
    const genAIEndpoint = 'together.chat.completions';
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const span = tracer.startSpan(genAIEndpoint, { kind: SpanKind.CLIENT });
        return context
          .with(trace.setSpan(context.active(), span), async () => {
            return originalMethod.apply(this, args);
          })
          .then((response: any) => {
            const { stream = false } = args[0];

            if (stream) {
              return OpenLitHelper.createStreamProxy(
                response,
                TogetherWrapper._chatCompletionGenerator({
                  args,
                  genAIEndpoint,
                  response,
                  span,
                })
              );
            }

            return TogetherWrapper._chatCompletion({ args, genAIEndpoint, response, span });
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
      metricParams = await TogetherWrapper._chatCompletionCommonSetter({
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
      const { messages } = args[0];
      const result = {
        id: '0',
        model: args[0].model || '',  // model is not in Together streaming chunks
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: { role: 'assistant', content: '' },
          },
        ],
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        },
      };

      let toolCalls: any[] = [];

      for await (const chunk of response) {
        timestamps.push(Date.now());

        // id is only present on the first chunk
        if (chunk.id) result.id = chunk.id;

        if (chunk.choices[0]?.finish_reason) {
          result.choices[0].finish_reason = chunk.choices[0].finish_reason;
        }
        if (chunk.choices[0]?.delta?.content) {
          result.choices[0].message.content += chunk.choices[0].delta.content;
        }

        // Handle tool calls for streaming
        if (chunk.choices[0]?.delta?.tool_calls) {
          const deltaTools = chunk.choices[0].delta.tool_calls;
          
          for (const tool of deltaTools) {
            const idx = tool.index || 0;
            
            while (toolCalls.length <= idx) {
              toolCalls.push({
                id: '',
                type: 'function',
                function: { name: '', arguments: '' }
              });
            }
            
            if (tool.id) {
              toolCalls[idx].id = tool.id;
              toolCalls[idx].type = tool.type || 'function';
              if (tool.function?.name) {
                toolCalls[idx].function.name = tool.function.name;
              }
              if (tool.function?.arguments) {
                toolCalls[idx].function.arguments = tool.function.arguments;
              }
            } else if (tool.function?.arguments) {
              toolCalls[idx].function.arguments += tool.function.arguments;
            }
          }
          
        }

        yield chunk;
      }
      
      if (toolCalls.length > 0) {
        result.choices[0].message = {
          ...result.choices[0].message,
          tool_calls: toolCalls
        } as any;
      }

      // Fall back to token estimation if usage wasn't returned in the stream
      if (!result.usage.prompt_tokens && !result.usage.completion_tokens) {
        let promptTokens = 0;
        for (const message of messages || []) {
          promptTokens += OpenLitHelper.openaiTokens(message.content as string, result.model) ?? 0;
        }
        const completionTokens = OpenLitHelper.openaiTokens(
          result.choices[0].message.content ?? '',
          result.model
        );
        if (completionTokens) {
          result.usage = {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: promptTokens + completionTokens,
          };
        }
      }

      // Calculate TTFT and TBT
      const ttft = timestamps.length > 0 ? (timestamps[0] - startTime) / 1000 : 0;
      let tbt = 0;
      if (timestamps.length > 1) {
        const timeDiffs = timestamps.slice(1).map((t, i) => t - timestamps[i]);
        tbt = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length / 1000;
      }

      metricParams = await TogetherWrapper._chatCompletionCommonSetter({
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
      frequency_penalty = 0,
      max_tokens = null,
      presence_penalty = 0,
      stop = null,
      temperature = 0.7,
      top_p,
      top_k,
      user,
      stream = false,
    } = args[0];

    // Request Params attributes
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_P, top_p || 1);
    if (top_k !== undefined) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_K, top_k);
    }
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, max_tokens || -1);
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, temperature);
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY, presence_penalty);
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY, frequency_penalty);
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, stream);
    if (stop) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES, Array.isArray(stop) ? stop : [stop]);
    }
    if (user) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_USER, user);
    }

    if (traceContent) {
      span.setAttribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, OpenLitHelper.buildInputMessages(messages || []));
    }

    span.setAttribute(
      SemanticConvention.GEN_AI_OPERATION,
      SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT
    );

    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_ID, result.id);

    const model = result.model || args[0].model || 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo';
    const responseModel = result.model || model;

    const pricingInfo = await OpenlitConfig.updatePricingJson(OpenlitConfig.pricing_json);

    // Calculate cost of the operation
    const cost = OpenLitHelper.getChatModelCost(
      model,
      pricingInfo,
      result.usage.prompt_tokens,
      result.usage.completion_tokens
    );

    TogetherWrapper.setBaseSpanAttributes(span, {
      genAIEndpoint,
      model,
      user,
      cost,
      aiSystem: TogetherWrapper.aiSystem,
      serverAddress: TogetherWrapper.serverAddress,
      serverPort: TogetherWrapper.serverPort,
    });

    // Response model
    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, responseModel);

    // Token usage
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, result.usage.prompt_tokens);
    span.setAttribute(
      SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS,
      result.usage.completion_tokens
    );
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS, result.usage.total_tokens);
    span.setAttribute(SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE, result.usage.total_tokens);
    
    // TTFT and TBT metrics
    if (ttft > 0) {
      span.setAttribute(SemanticConvention.GEN_AI_SERVER_TTFT, ttft);
    }
    if (tbt > 0) {
      span.setAttribute(SemanticConvention.GEN_AI_SERVER_TBT, tbt);
    }

    // Finish reason
    if (result.choices[0].finish_reason) {
      span.setAttribute(
        SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON,
        [result.choices[0].finish_reason]
      );
    }
    
    // Output type
    const outputType = typeof result.choices[0].message.content === 'string' 
      ? SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT 
      : SemanticConvention.GEN_AI_OUTPUT_TYPE_JSON;
    span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, outputType);

    // Tool calls handling
    if (result.choices[0].message.tool_calls) {
      const toolCalls = result.choices[0].message.tool_calls;
      const toolNames = toolCalls.map((t: any) => t.function?.name || '').filter(Boolean);
      const toolIds = toolCalls.map((t: any) => t.id || '').filter(Boolean);
      const toolArgs = toolCalls.map((t: any) => t.function?.arguments || '').filter(Boolean);
      const toolTypes = toolCalls.map((t: any) => t.type || '').filter(Boolean);
      
      if (toolNames.length > 0) {
        span.setAttribute(SemanticConvention.GEN_AI_TOOL_NAME, toolNames.join(', '));
      }
      if (toolIds.length > 0) {
        span.setAttribute(SemanticConvention.GEN_AI_TOOL_CALL_ID, toolIds.join(', '));
      }
      if (toolArgs.length > 0) {
        span.setAttribute(SemanticConvention.GEN_AI_TOOL_CALL_ARGUMENTS, toolArgs);
      }
      if (toolTypes.length > 0) {
        span.setAttribute(SemanticConvention.GEN_AI_TOOL_TYPE, toolTypes.join(', '));
      }
    }

    // Content
    if (traceContent) {
      const completionContent = result.choices[0].message.content || '';
      const toolCalls = result.choices[0].message.tool_calls;
      span.setAttribute(
        SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
        OpenLitHelper.buildOutputMessages(completionContent, result.choices[0].finish_reason || 'stop', toolCalls)
      );
    }

    return {
      genAIEndpoint,
      model,
      user,
      cost,
      aiSystem: TogetherWrapper.aiSystem,
    };
  }
}

export default TogetherWrapper;
