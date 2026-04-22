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
    [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: SemanticConvention.GEN_AI_SYSTEM_OPENAI,
    [SemanticConvention.GEN_AI_REQUEST_MODEL]: requestModel,
    [SemanticConvention.SERVER_ADDRESS]: OpenAIWrapper.serverAddress,
    [SemanticConvention.SERVER_PORT]: OpenAIWrapper.serverPort,
  };
}

class OpenAIWrapper extends BaseWrapper {
  static aiSystem = SemanticConvention.GEN_AI_SYSTEM_OPENAI;
  static serverAddress = 'api.openai.com';
  static serverPort = 443;
  static _patchChatCompletionCreate(tracer: Tracer): any {
    const genAIEndpoint = 'openai.resources.chat.completions';
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        if (isFrameworkLlmActive()) return originalMethod.apply(this, args);
        const requestModel = args[0]?.model || 'gpt-4o';
        const spanName = `${SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT} ${requestModel}`;
        const effectiveCtx = getFrameworkParentContext() ?? context.active();
        const span = tracer.startSpan(spanName, {
          kind: SpanKind.CLIENT,
          attributes: spanCreationAttrs(SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT, requestModel),
        }, effectiveCtx);
        return context
          .with(trace.setSpan(effectiveCtx, span), async () => {
            return originalMethod.apply(this, args);
          })
          .then((response: any) => {
            const { stream = false } = args[0];

            if (stream) {
              return OpenLitHelper.createStreamProxy(
                response,
                OpenAIWrapper._chatCompletionGenerator({
                  args,
                  genAIEndpoint,
                  response,
                  span,
                })
              );
            }

            return OpenAIWrapper._chatCompletion({ args, genAIEndpoint, response, span });
          })
          .catch((e: any) => {
            OpenLitHelper.handleException(span, e);
            BaseWrapper.recordMetrics(span, {
              genAIEndpoint,
              model: requestModel,
              aiSystem: OpenAIWrapper.aiSystem,
              serverAddress: OpenAIWrapper.serverAddress,
              serverPort: OpenAIWrapper.serverPort,
              errorType: e?.constructor?.name || '_OTHER',
            });
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
      metricParams = await OpenAIWrapper._chatCompletionCommonSetter({
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
      let { tools } = args[0];
      const result = {
        id: '0',
        created: -1,
        model: '',
        system_fingerprint: '',
        service_tier: 'auto',
        choices: [
          {
            index: 0,
            logprobs: null,
            finish_reason: 'stop',
            message: { role: 'assistant', content: '' },
          },
        ],
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
          completion_tokens_details: {
            reasoning_tokens: 0,
            audio_tokens: 0,
          },
          prompt_tokens_details: {
            cached_tokens: 0,
            audio_tokens: 0,
          },
        },
      };
      
      const toolCalls: any[] = [];
      
      for await (const chunk of response) {
        timestamps.push(Date.now());
        
        result.id = chunk.id;
        result.created = chunk.created;
        result.model = chunk.model;
        
        if (chunk.system_fingerprint) {
          result.system_fingerprint = chunk.system_fingerprint;
        }
        if (chunk.service_tier) {
          result.service_tier = chunk.service_tier;
        }

        if (chunk.choices[0]?.finish_reason) {
          result.choices[0].finish_reason = chunk.choices[0].finish_reason;
        }
        if (chunk.choices[0]?.logprobs) {
          result.choices[0].logprobs = chunk.choices[0].logprobs;
        }
        if (chunk.choices[0]?.delta.content) {
          result.choices[0].message.content += chunk.choices[0].delta.content;
        }

        if (chunk.choices[0]?.delta.tool_calls) {
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
          
          tools = true;
        }

        yield chunk;
      }
      
      if (toolCalls.length > 0) {
        result.choices[0].message = {
          ...result.choices[0].message,
          tool_calls: toolCalls
        } as any;
      }

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
          completion_tokens_details: result.usage.completion_tokens_details,
          prompt_tokens_details: result.usage.prompt_tokens_details,
        };
      }

      args[0].tools = tools;
      
      const ttft = timestamps.length > 0 ? (timestamps[0] - startTime) / 1000 : 0;
      let tbt = 0;
      if (timestamps.length > 1) {
        const timeDiffs = timestamps.slice(1).map((t, i) => t - timestamps[i]);
        tbt = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length / 1000;
      }

      metricParams = await OpenAIWrapper._chatCompletionCommonSetter({
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
    const captureContent = OpenlitConfig.captureMessageContent;
    const requestModel = args[0]?.model || 'gpt-4o';
    const {
      messages,
      frequency_penalty = 0,
      max_tokens = null,
      n = 1,
      presence_penalty = 0,
      seed = null,
      stop = null,
      temperature = 1,
      top_p,
      user,
      stream = false,
      tools: _tools,
      service_tier,
    } = args[0];

    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_P, top_p || 1);
    if (max_tokens != null) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, max_tokens);
    }
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, temperature);
    if (presence_penalty) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY, presence_penalty);
    }
    if (frequency_penalty) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY, frequency_penalty);
    }
    if (seed != null) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_SEED, Number(seed));
    }
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, stream);
    if (stop) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES, Array.isArray(stop) ? stop : [stop]);
    }
    if (n && n !== 1) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_CHOICE_COUNT, n);
    }
    if (service_tier && service_tier !== 'auto') {
      span.setAttribute(SemanticConvention.OPENAI_REQUEST_SERVICE_TIER, service_tier);
    }

    if (captureContent) {
      span.setAttribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, OpenLitHelper.buildInputMessages(messages || []));
    }

    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_ID, result.id);

    const responseModel = result.model || requestModel;

    const pricingInfo = OpenlitConfig.pricingInfo || {};

    const cost = OpenLitHelper.getChatModelCost(
      requestModel,
      pricingInfo,
      result.usage.prompt_tokens,
      result.usage.completion_tokens
    );

    OpenAIWrapper.setBaseSpanAttributes(span, {
      genAIEndpoint,
      model: requestModel,
      user,
      cost,
      aiSystem: OpenAIWrapper.aiSystem,
      serverAddress: OpenAIWrapper.serverAddress,
      serverPort: OpenAIWrapper.serverPort,
    });

    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, responseModel);

    span.setAttribute(SemanticConvention.OPENAI_API_TYPE, 'chat_completions');
    if (result.system_fingerprint) {
      span.setAttribute(SemanticConvention.OPENAI_RESPONSE_SYSTEM_FINGERPRINT, result.system_fingerprint);
    }
    if (result.service_tier) {
      span.setAttribute(SemanticConvention.OPENAI_RESPONSE_SERVICE_TIER, result.service_tier);
    }

    const inputTokens = result.usage.prompt_tokens;
    const outputTokens = result.usage.completion_tokens;
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, outputTokens);
    
    if (result.usage.prompt_tokens_details?.cached_tokens) {
      span.setAttribute(
        SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS,
        result.usage.prompt_tokens_details.cached_tokens
      );
    }
    if (result.usage.prompt_tokens_details?.cache_creation_tokens) {
      span.setAttribute(
        SemanticConvention.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS,
        result.usage.prompt_tokens_details.cache_creation_tokens
      );
    }
    
    if (ttft > 0) {
      span.setAttribute(SemanticConvention.GEN_AI_SERVER_TTFT, ttft);
    }
    if (tbt > 0) {
      span.setAttribute(SemanticConvention.GEN_AI_SERVER_TBT, tbt);
    }

    if (result.choices[0].finish_reason) {
      span.setAttribute(
        SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON,
        [result.choices[0].finish_reason]
      );
    }
    
    const outputType = typeof result.choices[0].message.content === 'string' 
      ? SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT 
      : SemanticConvention.GEN_AI_OUTPUT_TYPE_JSON;
    span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, outputType);

    if (result.choices[0].message.tool_calls) {
      const toolCalls = result.choices[0].message.tool_calls;
      const toolNames = toolCalls.map((t: any) => t.function?.name || '').filter(Boolean);
      const toolIds = toolCalls.map((t: any) => t.id || '').filter(Boolean);
      const toolArgs = toolCalls.map((t: any) => t.function?.arguments || '').filter(Boolean);
      
      if (toolNames.length > 0) {
        span.setAttribute(SemanticConvention.GEN_AI_TOOL_NAME, toolNames.join(', '));
      }
      if (toolIds.length > 0) {
        span.setAttribute(SemanticConvention.GEN_AI_TOOL_CALL_ID, toolIds.join(', '));
      }
      if (toolArgs.length > 0) {
        span.setAttribute(SemanticConvention.GEN_AI_TOOL_ARGS, toolArgs.join(', '));
      }
    }

    let inputMessagesJson: string | undefined;
    let outputMessagesJson: string | undefined;
    if (captureContent) {
      const toolCalls = result.choices[0].message.tool_calls;
      outputMessagesJson = OpenLitHelper.buildOutputMessages(
        result.choices[0].message.content || '',
        result.choices[0].finish_reason || 'stop',
        toolCalls
      );
      span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_MESSAGES, outputMessagesJson);
      inputMessagesJson = OpenLitHelper.buildInputMessages(messages || []);
    }

    if (!OpenlitConfig.disableEvents) {
      const eventAttrs: Attributes = {
        [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
        [SemanticConvention.GEN_AI_REQUEST_MODEL]: requestModel,
        [SemanticConvention.GEN_AI_RESPONSE_MODEL]: responseModel,
        [SemanticConvention.SERVER_ADDRESS]: OpenAIWrapper.serverAddress,
        [SemanticConvention.SERVER_PORT]: OpenAIWrapper.serverPort,
        [SemanticConvention.GEN_AI_RESPONSE_ID]: result.id,
        [SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON]: [result.choices[0].finish_reason],
        [SemanticConvention.GEN_AI_OUTPUT_TYPE]: outputType,
        [SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS]: inputTokens,
        [SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS]: outputTokens,
      };
      if (captureContent) {
        if (inputMessagesJson) eventAttrs[SemanticConvention.GEN_AI_INPUT_MESSAGES] = inputMessagesJson;
        if (outputMessagesJson) eventAttrs[SemanticConvention.GEN_AI_OUTPUT_MESSAGES] = outputMessagesJson;
      }
      OpenLitHelper.emitInferenceEvent(span, eventAttrs);
    }

    return {
      genAIEndpoint,
      model: requestModel,
      user,
      cost,
      aiSystem: OpenAIWrapper.aiSystem,
    };
  }

  static _patchEmbedding(tracer: Tracer): any {
    const genAIEndpoint = 'openai.resources.embeddings';

    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        if (isFrameworkLlmActive()) return originalMethod.apply(this, args);
        const requestModel = args[0]?.model || 'text-embedding-ada-002';
        const spanName = `${SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING} ${requestModel}`;
        const effectiveCtx = getFrameworkParentContext() ?? context.active();
        const span = tracer.startSpan(spanName, {
          kind: SpanKind.CLIENT,
          attributes: spanCreationAttrs(SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING, requestModel),
        }, effectiveCtx);
        return context.with(trace.setSpan(effectiveCtx, span), async () => {
          const captureContent = OpenlitConfig.captureMessageContent;
          let metricParams: BaseSpanAttributes | undefined;
          try {
            const response = await originalMethod.apply(this, args);

            const _responseModel = response.model || requestModel;
            const pricingInfo = OpenlitConfig.pricingInfo || {};
            const cost = OpenLitHelper.getEmbedModelCost(
              requestModel,
              pricingInfo,
              response.usage.prompt_tokens
            );

            const { dimensions, encoding_format = 'float', input, user } = args[0];
            OpenAIWrapper.setBaseSpanAttributes(span, {
              genAIEndpoint,
              model: requestModel,
              user,
              cost,
              aiSystem: OpenAIWrapper.aiSystem,
              serverAddress: OpenAIWrapper.serverAddress,
              serverPort: OpenAIWrapper.serverPort,
            });

            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, false);
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_ENCODING_FORMATS, [encoding_format]);
            if (dimensions) {
              span.setAttribute(SemanticConvention.GEN_AI_EMBEDDINGS_DIMENSION_COUNT, dimensions);
            }
            if (captureContent) {
              const formattedInput = typeof input === 'string' ? input : JSON.stringify(input);
              span.setAttribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, formattedInput);
            }

            span.setAttribute(
              SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS,
              response.usage.prompt_tokens
            );

            metricParams = {
              genAIEndpoint,
              model: requestModel,
              user,
              cost,
              aiSystem: OpenAIWrapper.aiSystem,
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
        });
      };
    };
  }

  static _patchFineTune(tracer: Tracer): any {
    const genAIEndpoint = 'openai.resources.fine_tuning.jobs';

    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        if (isFrameworkLlmActive()) return originalMethod.apply(this, args);
        const requestModel = args[0]?.model || 'gpt-3.5-turbo';
        const spanName = `${SemanticConvention.GEN_AI_OPERATION_TYPE_FINETUNING} ${requestModel}`;
        const effectiveCtx = getFrameworkParentContext() ?? context.active();
        const span = tracer.startSpan(spanName, {
          kind: SpanKind.CLIENT,
          attributes: spanCreationAttrs(SemanticConvention.GEN_AI_OPERATION_TYPE_FINETUNING, requestModel),
        }, effectiveCtx);
        return context.with(trace.setSpan(effectiveCtx, span), async () => {
          let metricParams;
          try {
            const response = await originalMethod.apply(this, args);

            const {
              hyperparameters = {},
              suffix = '',
              training_file,
              user,
              validation_file,
            } = args[0];

            OpenAIWrapper.setBaseSpanAttributes(span, {
              genAIEndpoint,
              model: requestModel,
              user,
              aiSystem: OpenAIWrapper.aiSystem,
              serverAddress: OpenAIWrapper.serverAddress,
              serverPort: OpenAIWrapper.serverPort,
            });

            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TRAINING_FILE, training_file);
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_VALIDATION_FILE, validation_file);
            span.setAttribute(
              SemanticConvention.GEN_AI_REQUEST_FINETUNE_BATCH_SIZE,
              hyperparameters?.batch_size || 'auto'
            );
            span.setAttribute(
              SemanticConvention.GEN_AI_REQUEST_FINETUNE_MODEL_LRM,
              hyperparameters?.learning_rate_multiplier || 'auto'
            );
            span.setAttribute(
              SemanticConvention.GEN_AI_REQUEST_FINETUNE_MODEL_EPOCHS,
              hyperparameters?.n_epochs || 'auto'
            );
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_FINETUNE_MODEL_SUFFIX, suffix);

            span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_ID, response.id);
            span.setAttribute(
              SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS,
              response.usage.prompt_tokens
            );
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_FINETUNE_STATUS, response.status);

            metricParams = {
              genAIEndpoint,
              model: requestModel,
              user,
              aiSystem: OpenAIWrapper.aiSystem,
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
        });
      };
    };
  }

  static _patchImageGenerate(tracer: Tracer): any {
    const genAIEndpoint = 'openai.resources.images';
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        if (isFrameworkLlmActive()) return originalMethod.apply(this, args);
        const requestModel = args[0]?.model || 'dall-e-2';
        const spanName = `${SemanticConvention.GEN_AI_OPERATION_TYPE_IMAGE} ${requestModel}`;
        const effectiveCtx = getFrameworkParentContext() ?? context.active();
        const span = tracer.startSpan(spanName, {
          kind: SpanKind.CLIENT,
          attributes: spanCreationAttrs(SemanticConvention.GEN_AI_OPERATION_TYPE_IMAGE, requestModel),
        }, effectiveCtx);
        return context.with(trace.setSpan(effectiveCtx, span), async () => {
          const captureContent = OpenlitConfig.captureMessageContent;
          let metricParams;
          try {
            const response = await originalMethod.apply(this, args);

            const {
              prompt,
              quality = 'standard',
              response_format = 'url',
              size = '1024x1024',
              style = 'vivid',
              user,
            } = args[0];

            const responseModel = response.model || requestModel;

            const pricingInfo = OpenlitConfig.pricingInfo || {};
            const cost =
              (response.data?.length || 1) *
              OpenLitHelper.getImageModelCost(responseModel, pricingInfo, size, quality);

            OpenAIWrapper.setBaseSpanAttributes(span, {
              genAIEndpoint,
              model: requestModel,
              user,
              cost,
              aiSystem: OpenAIWrapper.aiSystem,
              serverAddress: OpenAIWrapper.serverAddress,
              serverPort: OpenAIWrapper.serverPort,
            });

            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IMAGE_SIZE, size);
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IMAGE_QUALITY, quality);
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IMAGE_STYLE, style);

            if (captureContent) {
              span.setAttribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, prompt);
            }

            if (response.data) {
              const imageUrls: string[] = [];
              const revisedPrompts: string[] = [];
              for (const items of response.data) {
                revisedPrompts.push(items.revised_prompt || '');
                const value = items[response_format];
                imageUrls.push(value && !String(value).startsWith('data:') ? value : '[base64_image_data]');
              }
              span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_IMAGE, imageUrls);
              span.setAttribute(SemanticConvention.GEN_AI_CONTENT_REVISED_PROMPT, revisedPrompts);
            }

            metricParams = {
              genAIEndpoint,
              model: requestModel,
              user,
              cost,
              aiSystem: OpenAIWrapper.aiSystem,
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
        });
      };
    };
  }

  static _patchImageVariation(tracer: Tracer): any {
    const genAIEndpoint = 'openai.resources.images';
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        if (isFrameworkLlmActive()) return originalMethod.apply(this, args);
        const requestModel = args[0]?.model || 'dall-e-2';
        const spanName = `${SemanticConvention.GEN_AI_OPERATION_TYPE_IMAGE} ${requestModel}`;
        const effectiveCtx = getFrameworkParentContext() ?? context.active();
        const span = tracer.startSpan(spanName, {
          kind: SpanKind.CLIENT,
          attributes: spanCreationAttrs(SemanticConvention.GEN_AI_OPERATION_TYPE_IMAGE, requestModel),
        }, effectiveCtx);
        return context.with(trace.setSpan(effectiveCtx, span), async () => {
          const captureContent = OpenlitConfig.captureMessageContent;
          let metricParams;
          try {
            const response = await originalMethod.apply(this, args);

            const {
              prompt,
              quality = 'standard',
              response_format = 'url',
              size = '1024x1024',
              style = 'vivid',
              user,
            } = args[0];

            span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_ID, response.created);

            const responseModel = response.model || requestModel;

            const pricingInfo = OpenlitConfig.pricingInfo || {};
            const cost =
              (response.data?.length || 1) *
              OpenLitHelper.getImageModelCost(responseModel, pricingInfo, size, quality);

            OpenAIWrapper.setBaseSpanAttributes(span, {
              genAIEndpoint,
              model: requestModel,
              user,
              cost,
              aiSystem: OpenAIWrapper.aiSystem,
              serverAddress: OpenAIWrapper.serverAddress,
              serverPort: OpenAIWrapper.serverPort,
            });

            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IMAGE_SIZE, size);
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IMAGE_QUALITY, quality);
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IMAGE_STYLE, style);

            if (captureContent) {
              span.setAttribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, prompt);
            }

            if (response.data) {
              const imageUrls: string[] = [];
              const revisedPrompts: string[] = [];
              for (const items of response.data) {
                revisedPrompts.push(items.revised_prompt || '');
                const value = items[response_format];
                imageUrls.push(value && !String(value).startsWith('data:') ? value : '[base64_image_data]');
              }
              span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_IMAGE, imageUrls);
              span.setAttribute(SemanticConvention.GEN_AI_CONTENT_REVISED_PROMPT, revisedPrompts);
            }

            metricParams = {
              genAIEndpoint,
              model: requestModel,
              user,
              cost,
              aiSystem: OpenAIWrapper.aiSystem,
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
        });
      };
    };
  }

  static _patchAudioCreate(tracer: Tracer): any {
    const genAIEndpoint = 'openai.resources.audio.speech';
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        if (isFrameworkLlmActive()) return originalMethod.apply(this, args);
        const requestModel = args[0]?.model || 'tts-1';
        const spanName = `${SemanticConvention.GEN_AI_OPERATION_TYPE_AUDIO} ${requestModel}`;
        const effectiveCtx = getFrameworkParentContext() ?? context.active();
        const span = tracer.startSpan(spanName, {
          kind: SpanKind.CLIENT,
          attributes: spanCreationAttrs(SemanticConvention.GEN_AI_OPERATION_TYPE_AUDIO, requestModel),
        }, effectiveCtx);
        return context.with(trace.setSpan(effectiveCtx, span), async () => {
          const captureContent = OpenlitConfig.captureMessageContent;
          let metricParams;
          try {
            const response = await originalMethod.apply(this, args);

            const { input, user, voice, response_format = 'mp3', speed = 1 } = args[0];

            const responseModel = response.model || requestModel;

            const pricingInfo = OpenlitConfig.pricingInfo || {};
            const cost = OpenLitHelper.getAudioModelCost(responseModel, pricingInfo, input);

            OpenAIWrapper.setBaseSpanAttributes(span, {
              genAIEndpoint,
              model: requestModel,
              user,
              cost,
              aiSystem: OpenAIWrapper.aiSystem,
              serverAddress: OpenAIWrapper.serverAddress,
              serverPort: OpenAIWrapper.serverPort,
            });

            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_AUDIO_VOICE, voice);
            span.setAttribute(
              SemanticConvention.GEN_AI_REQUEST_AUDIO_RESPONSE_FORMAT,
              response_format
            );
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_AUDIO_SPEED, speed);

            if (captureContent) {
              span.setAttribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, input);
            }

            metricParams = {
              genAIEndpoint,
              model: requestModel,
              user,
              cost,
              aiSystem: OpenAIWrapper.aiSystem,
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
        });
      };
    };
  }

  static _patchResponsesCreate(tracer: Tracer): any {
    const genAIEndpoint = 'openai.resources.responses';
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        if (isFrameworkLlmActive()) return originalMethod.apply(this, args);
        const requestModel = args[0]?.model || 'gpt-4o';
        const spanName = `${SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT} ${requestModel}`;
        const effectiveCtx = getFrameworkParentContext() ?? context.active();
        const span = tracer.startSpan(spanName, {
          kind: SpanKind.CLIENT,
          attributes: spanCreationAttrs(SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT, requestModel),
        }, effectiveCtx);
        return context
          .with(trace.setSpan(effectiveCtx, span), async () => {
            return originalMethod.apply(this, args);
          })
          .then((response: any) => {
            const { stream = false } = args[0];

            if (stream) {
              return OpenLitHelper.createStreamProxy(
                response,
                OpenAIWrapper._responsesGenerator({
                  args,
                  genAIEndpoint,
                  response,
                  span,
                })
              );
            }

            return OpenAIWrapper._responsesComplete({ args, genAIEndpoint, response, span });
          })
          .catch((e: any) => {
            OpenLitHelper.handleException(span, e);
            BaseWrapper.recordMetrics(span, {
              genAIEndpoint,
              model: requestModel,
              aiSystem: OpenAIWrapper.aiSystem,
              serverAddress: OpenAIWrapper.serverAddress,
              serverPort: OpenAIWrapper.serverPort,
              errorType: e?.constructor?.name || '_OTHER',
            });
            span.end();
            throw e;
          });
      };
    };
  }

  static async _responsesComplete({
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
      metricParams = await OpenAIWrapper._responsesCommonSetter({
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

  static async *_responsesGenerator({
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
      const result = {
        id: '',
        model: '',
        service_tier: 'default',
        status: 'completed',
        output: [] as any[],
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          output_tokens_details: {
            reasoning_tokens: 0,
          },
        },
      };
      
      let llmResponse = '';
      const responseTools: any[] = [];
      
      for await (const chunk of response) {
        timestamps.push(Date.now());
        
        if (chunk.type === 'response.output_text.delta') {
          llmResponse += chunk.delta || '';
        } else if (chunk.type === 'response.output_item.added') {
          const item = chunk.item;
          if (item?.type === 'function_call') {
            responseTools.push({
              id: item.id,
              call_id: item.call_id,
              name: item.name,
              type: item.type,
              arguments: item.arguments || '',
              status: item.status,
            });
          }
        } else if (chunk.type === 'response.function_call_arguments.delta') {
          const itemId = chunk.item_id;
          const delta = chunk.delta || '';
          const tool = responseTools.find(t => t.id === itemId);
          if (tool) {
            tool.arguments += delta;
          }
        } else if (chunk.type === 'response.completed') {
          const responseData = chunk.response;
          result.id = responseData.id;
          result.model = responseData.model;
          result.status = responseData.status;
          
          const usage = responseData.usage || {};
          result.usage.input_tokens = usage.input_tokens || 0;
          result.usage.output_tokens = usage.output_tokens || 0;
          result.usage.output_tokens_details.reasoning_tokens = 
            usage.output_tokens_details?.reasoning_tokens || 0;
        }

        yield chunk;
      }
      
      if (llmResponse) {
        result.output.push({
          type: 'message',
          content: [{ type: 'text', text: llmResponse }],
        });
      }
      
      if (responseTools.length > 0) {
        result.output.push(...responseTools);
      }
      
      const ttft = timestamps.length > 0 ? (timestamps[0] - startTime) / 1000 : 0;
      let tbt = 0;
      if (timestamps.length > 1) {
        const timeDiffs = timestamps.slice(1).map((t, i) => t - timestamps[i]);
        tbt = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length / 1000;
      }

      metricParams = await OpenAIWrapper._responsesCommonSetter({
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

  static async _responsesCommonSetter({
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
    const captureContent = OpenlitConfig.captureMessageContent;
    const requestModel = args[0]?.model || 'gpt-4o';
    const {
      input,
      temperature = 1.0,
      top_p = 1.0,
      max_output_tokens,
      reasoning,
      stream = false,
    } = args[0];

    const responsesMessages = typeof input === 'string'
      ? [{ role: 'user', content: input }]
      : (Array.isArray(input) ? input : []);

    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, temperature);
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_P, top_p);
    if (max_output_tokens != null) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, max_output_tokens);
    }
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, stream);

    if (reasoning?.effort) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_REASONING_EFFORT, reasoning.effort);
    }

    if (captureContent) {
      span.setAttribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, OpenLitHelper.buildInputMessages(responsesMessages));
    }

    const responseModel = result.model || requestModel;

    const pricingInfo = OpenlitConfig.pricingInfo || {};

    const inputTokens = result.usage?.input_tokens || 0;
    const outputTokens = result.usage?.output_tokens || 0;
    const cost = OpenLitHelper.getChatModelCost(
      requestModel,
      pricingInfo,
      inputTokens,
      outputTokens
    );

    OpenAIWrapper.setBaseSpanAttributes(span, {
      genAIEndpoint,
      model: requestModel,
      user: '',
      cost,
      aiSystem: OpenAIWrapper.aiSystem,
      serverAddress: OpenAIWrapper.serverAddress,
      serverPort: OpenAIWrapper.serverPort,
    });

    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_ID, result.id);
    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, responseModel);
    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, [result.status || 'completed']);
    span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT);
    
    span.setAttribute(SemanticConvention.OPENAI_API_TYPE, 'responses');
    if (result.service_tier) {
      span.setAttribute(SemanticConvention.OPENAI_RESPONSE_SERVICE_TIER, result.service_tier);
    }

    span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, outputTokens);
    
    if (result.usage?.output_tokens_details?.reasoning_tokens) {
      span.setAttribute(
        SemanticConvention.GEN_AI_USAGE_REASONING_TOKENS,
        result.usage.output_tokens_details.reasoning_tokens
      );
    }
    
    if (ttft > 0) {
      span.setAttribute(SemanticConvention.GEN_AI_SERVER_TTFT, ttft);
    }
    if (tbt > 0) {
      span.setAttribute(SemanticConvention.GEN_AI_SERVER_TBT, tbt);
    }

    let completionText = '';
    if (result.output && Array.isArray(result.output)) {
      for (const item of result.output) {
        if (item.type === 'message' && item.content) {
          for (const content of item.content) {
            if (content.type === 'text' || content.type === 'output_text') {
              completionText += content.text || '';
            }
          }
        }
      }
    }

    const toolCalls = result.tools || [];
    if (toolCalls.length > 0) {
      const toolNames = toolCalls.map((t: any) => t.name || '').filter(Boolean);
      const toolIds = toolCalls.map((t: any) => t.call_id || '').filter(Boolean);
      const toolArgs = toolCalls.map((t: any) => t.arguments || '').filter(Boolean);
      
      if (toolNames.length > 0) {
        span.setAttribute(SemanticConvention.GEN_AI_TOOL_NAME, toolNames.join(', '));
      }
      if (toolIds.length > 0) {
        span.setAttribute(SemanticConvention.GEN_AI_TOOL_CALL_ID, toolIds.join(', '));
      }
      if (toolArgs.length > 0) {
        span.setAttribute(SemanticConvention.GEN_AI_TOOL_ARGS, toolArgs.join(', '));
      }
    }

    let inputMessagesJson: string | undefined;
    let outputMessagesJson: string | undefined;
    if (captureContent) {
      outputMessagesJson = OpenLitHelper.buildOutputMessages(completionText, result.status || 'stop');
      span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_MESSAGES, outputMessagesJson);
      inputMessagesJson = OpenLitHelper.buildInputMessages(responsesMessages);
    }

    if (!OpenlitConfig.disableEvents) {
      const eventAttrs: Attributes = {
        [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
        [SemanticConvention.GEN_AI_REQUEST_MODEL]: requestModel,
        [SemanticConvention.GEN_AI_RESPONSE_MODEL]: responseModel,
        [SemanticConvention.SERVER_ADDRESS]: OpenAIWrapper.serverAddress,
        [SemanticConvention.SERVER_PORT]: OpenAIWrapper.serverPort,
        [SemanticConvention.GEN_AI_RESPONSE_ID]: result.id,
        [SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON]: [result.status || 'completed'],
        [SemanticConvention.GEN_AI_OUTPUT_TYPE]: SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT,
        [SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS]: inputTokens,
        [SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS]: outputTokens,
      };
      if (captureContent) {
        if (inputMessagesJson) eventAttrs[SemanticConvention.GEN_AI_INPUT_MESSAGES] = inputMessagesJson;
        if (outputMessagesJson) eventAttrs[SemanticConvention.GEN_AI_OUTPUT_MESSAGES] = outputMessagesJson;
      }
      OpenLitHelper.emitInferenceEvent(span, eventAttrs);
    }

    return {
      genAIEndpoint,
      model: requestModel,
      user: '',
      cost,
      aiSystem: OpenAIWrapper.aiSystem,
    };
  }
}

export default OpenAIWrapper;
