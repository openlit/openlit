import { Span, SpanKind, Tracer, context, trace } from '@opentelemetry/api';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import SemanticConvention from '../../semantic-convention';
import BaseWrapper, { BaseSpanAttributes } from '../base-wrapper';

class OpenAIWrapper extends BaseWrapper {
  static aiSystem = SemanticConvention.GEN_AI_SYSTEM_OPENAI;
  static _patchChatCompletionCreate(tracer: Tracer): any {
    const genAIEndpoint = 'openai.resources.chat.completions';
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
            span.end();
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
    } finally {
      span.end();
      // Record metrics after span has ended if parameters are available
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
    try {
      const { messages } = args[0];
      let { tools } = args[0];
      const result = {
        id: '0',
        created: -1,
        model: '',
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
        },
      };
      for await (const chunk of response) {
        result.id = chunk.id;
        result.created = chunk.created;
        result.model = chunk.model;

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
          tools = true;
        }

        yield chunk;
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
        };
      }

      args[0].tools = tools;

      metricParams = await OpenAIWrapper._chatCompletionCommonSetter({
        args,
        genAIEndpoint,
        result,
        span,
      });

      return result;
    } catch (e: any) {
      OpenLitHelper.handleException(span, e);
    } finally {
      span.end();
      // Record metrics after span has ended if parameters are available
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
  }: {
    args: any[];
    genAIEndpoint: string;
    result: any;
    span: Span;
  }) {
    const traceContent = OpenlitConfig.traceContent;
    const {
      messages,
      frequency_penalty = 0,
      max_tokens = null,
      n = 1,
      presence_penalty = 0,
      seed = null,
      temperature = 1,
      top_p,
      user,
      stream = false,
      tools,
    } = args[0];

    // Request Params attributes : Start
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_P, top_p || 1);
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, max_tokens);
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, temperature);
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY, presence_penalty);
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY, frequency_penalty);
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_SEED, seed);
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, stream);

    if (traceContent) {
      // Format 'messages' into a single string
      const messagePrompt = messages || [];
      const formattedMessages = [];

      for (const message of messagePrompt) {
        const role = message.role;
        const content = message.content;

        if (Array.isArray(content)) {
          const contentStr = content
            .map((item) => {
              if ('type' in item) {
                return `${item.type}: ${item.text ? item.text : item.image_url}`;
              } else {
                return `text: ${item.text}`;
              }
            })
            .join(', ');
          formattedMessages.push(`${role}: ${contentStr}`);
        } else {
          formattedMessages.push(`${role}: ${content}`);
        }
      }

      const prompt = formattedMessages.join('\n');
      span.setAttribute(SemanticConvention.GEN_AI_CONTENT_PROMPT, prompt);
    }
    // Request Params attributes : End

    span.setAttribute(
      SemanticConvention.GEN_AI_OPERATION,
      SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT
    );

    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_ID, result.id);

    const model = result.model || 'gpt-3.5-turbo';

    const pricingInfo = await OpenlitConfig.updatePricingJson(OpenlitConfig.pricing_json);

    // Calculate cost of the operation
    const cost = OpenLitHelper.getChatModelCost(
      model,
      pricingInfo,
      result.usage.prompt_tokens,
      result.usage.completion_tokens
    );

    OpenAIWrapper.setBaseSpanAttributes(span, {
      genAIEndpoint,
      model,
      user,
      cost,
      aiSystem: OpenAIWrapper.aiSystem,
    });

    span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, result.usage.prompt_tokens);
    span.setAttribute(
      SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS,
      result.usage.completion_tokens
    );
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS, result.usage.total_tokens);

    if (result.choices[0].finish_reason) {
      span.setAttribute(
        SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON,
        result.choices[0].finish_reason
      );
    }

    if (tools) {
      span.setAttribute(SemanticConvention.GEN_AI_CONTENT_COMPLETION, 'Function called with tools');
    } else {
      if (traceContent) {
        if (n === 1) {
          span.setAttribute(
            SemanticConvention.GEN_AI_CONTENT_COMPLETION,
            result.choices[0].message.content
          );
        } else {
          let i = 0;
          while (i < n) {
            const attribute_name = `${SemanticConvention.GEN_AI_CONTENT_COMPLETION}.[i]`;
            span.setAttribute(attribute_name, result.choices[i].message.content);
            i += 1;
          }
        }
      }
    }

    return {
      genAIEndpoint,
      model,
      user,
      cost,
      aiSystem: OpenAIWrapper.aiSystem,
    };
  }

  static _patchEmbedding(tracer: Tracer): any {
    const genAIEndpoint = 'openai.resources.embeddings';
    const traceContent = OpenlitConfig.traceContent;

    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const span = tracer.startSpan(genAIEndpoint, { kind: SpanKind.CLIENT });
        return context.with(trace.setSpan(context.active(), span), async () => {
          let metricParams: BaseSpanAttributes = {
            genAIEndpoint,
            model: '',
            user: '',
            cost: 0,
            aiSystem: OpenAIWrapper.aiSystem,
          };
          try {
            const response = await originalMethod.apply(this, args);

            const model = response.model || 'text-embedding-ada-002';
            const pricingInfo = await OpenlitConfig.updatePricingJson(OpenlitConfig.pricing_json);
            const cost = OpenLitHelper.getEmbedModelCost(
              model,
              pricingInfo,
              response.usage.prompt_tokens
            );

            span.setAttribute(
              SemanticConvention.GEN_AI_OPERATION,
              SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING
            );

            const { dimensions, encoding_format = 'float', input, user } = args[0];
            // Set base span attribues
            OpenAIWrapper.setBaseSpanAttributes(span, {
              genAIEndpoint,
              model,
              user,
              cost,
              aiSystem: OpenAIWrapper.aiSystem,
            });

            // Request Params attributes : Start
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_ENCODING_FORMATS, encoding_format);
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_EMBEDDING_DIMENSION, dimensions);
            if (traceContent) {
              span.setAttribute(SemanticConvention.GEN_AI_CONTENT_PROMPT, input);
            }

            // Request Params attributes : End
            span.setAttribute(
              SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS,
              response.usage.prompt_tokens
            );
            span.setAttribute(
              SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS,
              response.usage.total_tokens
            );

            metricParams = {
              genAIEndpoint,
              model,
              user,
              cost,
              aiSystem: OpenAIWrapper.aiSystem,
            };

            return response;
          } catch (e: any) {
            OpenLitHelper.handleException(span, e);
          } finally {
            span.end();
            BaseWrapper.recordMetrics(span, metricParams);
          }
        });
      };
    };
  }

  static _patchFineTune(tracer: Tracer): any {
    const genAIEndpoint = 'openai.resources.fine_tuning.jobs';

    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const span = tracer.startSpan(genAIEndpoint, { kind: SpanKind.CLIENT });
        return context.with(trace.setSpan(context.active(), span), async () => {
          let metricParams;
          try {
            const response = await originalMethod.apply(this, args);

            const model = response.model || 'gpt-3.5-turbo';
            const {
              hyperparameters = {},
              suffix = '',
              training_file,
              user,
              validation_file,
            } = args[0];

            // Set base span attribues
            OpenAIWrapper.setBaseSpanAttributes(span, {
              genAIEndpoint,
              model,
              user,
              aiSystem: OpenAIWrapper.aiSystem,
            });

            span.setAttribute(
              SemanticConvention.GEN_AI_OPERATION,
              SemanticConvention.GEN_AI_OPERATION_TYPE_FINETUNING
            );

            // Request Params attributes : Start

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
            // Request Params attributes : End

            span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_ID, response.id);
            span.setAttribute(
              SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS,
              response.usage.prompt_tokens
            );
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_FINETUNE_STATUS, response.status);

            // Store metric parameters for use after span ends
            metricParams = {
              genAIEndpoint,
              model,
              user,
              aiSystem: OpenAIWrapper.aiSystem,
            };

            return response;
          } catch (e: any) {
            OpenLitHelper.handleException(span, e);
          } finally {
            span.end();
            // Record metrics after span has ended if parameters are available
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
    const traceContent = OpenlitConfig.traceContent;
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const span = tracer.startSpan(genAIEndpoint, { kind: SpanKind.CLIENT });
        return context.with(trace.setSpan(context.active(), span), async () => {
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

            span.setAttribute(
              SemanticConvention.GEN_AI_OPERATION,
              SemanticConvention.GEN_AI_OPERATION_TYPE_IMAGE
            );

            const model = response.model || 'dall-e-2';

            const pricingInfo = await OpenlitConfig.updatePricingJson(OpenlitConfig.pricing_json);

            // Calculate cost of the operation
            const cost =
              (response.data?.length || 1) *
              OpenLitHelper.getImageModelCost(model, pricingInfo, size, quality);

            OpenAIWrapper.setBaseSpanAttributes(span, {
              genAIEndpoint,
              model,
              user,
              cost,
              aiSystem: OpenAIWrapper.aiSystem,
            });

            // Request Params attributes : Start
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IMAGE_SIZE, size);
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IMAGE_QUALITY, quality);
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IMAGE_STYLE, style);

            if (traceContent) {
              span.setAttribute(SemanticConvention.GEN_AI_CONTENT_PROMPT, prompt);
            }
            // Request Params attributes : End

            let imagesCount = 0;

            if (response.data) {
              for (const items of response.data) {
                span.setAttribute(
                  `${SemanticConvention.GEN_AI_CONTENT_REVISED_PROMPT}.${imagesCount}`,
                  items.revised_prompt || ''
                );

                const attributeName = `${SemanticConvention.GEN_AI_RESPONSE_IMAGE}.${imagesCount}`;
                span.setAttribute(attributeName, items[response_format]);

                imagesCount++;
              }
            }

            // Store metric parameters for use after span ends
            metricParams = {
              genAIEndpoint,
              model,
              user,
              cost,
              aiSystem: OpenAIWrapper.aiSystem,
            };

            return response;
          } catch (e: any) {
            OpenLitHelper.handleException(span, e);
          } finally {
            span.end();
            // Record metrics after span has ended if parameters are available
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
    const traceContent = OpenlitConfig.traceContent;
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const span = tracer.startSpan(genAIEndpoint, { kind: SpanKind.CLIENT });
        return context.with(trace.setSpan(context.active(), span), async () => {
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

            span.setAttribute(
              SemanticConvention.GEN_AI_OPERATION,
              SemanticConvention.GEN_AI_OPERATION_TYPE_IMAGE
            );
            span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_ID, response.created);

            const model = response.model || 'dall-e-2';

            const pricingInfo = await OpenlitConfig.updatePricingJson(OpenlitConfig.pricing_json);

            // Calculate cost of the operation
            const cost =
              (response.data?.length || 1) *
              OpenLitHelper.getImageModelCost(model, pricingInfo, size, quality);

            OpenAIWrapper.setBaseSpanAttributes(span, {
              genAIEndpoint,
              model,
              user,
              cost,
              aiSystem: OpenAIWrapper.aiSystem,
            });

            // Request Params attributes : Start
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IMAGE_SIZE, size);
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IMAGE_QUALITY, quality);
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IMAGE_STYLE, style);

            if (traceContent) {
              span.setAttribute(SemanticConvention.GEN_AI_CONTENT_PROMPT, prompt);
            }
            // Request Params attributes : End

            let imagesCount = 0;
            if (response.data) {
              for (const items of response.data) {
                span.setAttribute(
                  `${SemanticConvention.GEN_AI_CONTENT_REVISED_PROMPT}.${imagesCount}`,
                  items.revised_prompt || ''
                );

                const attributeName = `${SemanticConvention.GEN_AI_RESPONSE_IMAGE}.${imagesCount}`;
                span.setAttribute(attributeName, items[response_format]);

                imagesCount++;
              }
            }

            // Store metric parameters for use after span ends
            metricParams = {
              genAIEndpoint,
              model,
              user,
              cost,
              aiSystem: OpenAIWrapper.aiSystem,
            };

            return response;
          } catch (e: any) {
            OpenLitHelper.handleException(span, e);
          } finally {
            span.end();
            // Record metrics after span has ended if parameters are available
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
    const traceContent = OpenlitConfig.traceContent;
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const span = tracer.startSpan(genAIEndpoint, { kind: SpanKind.CLIENT });
        return context.with(trace.setSpan(context.active(), span), async () => {
          let metricParams;
          try {
            const response = await originalMethod.apply(this, args);

            const { input, user, voice, response_format = 'mp3', speed = 1 } = args[0];

            span.setAttribute(
              SemanticConvention.GEN_AI_OPERATION,
              SemanticConvention.GEN_AI_OPERATION_TYPE_AUDIO
            );

            const model = response.model || 'tts-1';

            const pricingInfo = await OpenlitConfig.updatePricingJson(OpenlitConfig.pricing_json);

            // Calculate cost of the operation
            const cost = OpenLitHelper.getAudioModelCost(model, pricingInfo, input);

            OpenAIWrapper.setBaseSpanAttributes(span, {
              genAIEndpoint,
              model,
              user,
              cost,
              aiSystem: OpenAIWrapper.aiSystem,
            });

            // Request Params attributes : Start
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_AUDIO_VOICE, voice);
            span.setAttribute(
              SemanticConvention.GEN_AI_REQUEST_AUDIO_RESPONSE_FORMAT,
              response_format
            );
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_AUDIO_SPEED, speed);

            if (traceContent) {
              span.setAttribute(SemanticConvention.GEN_AI_CONTENT_PROMPT, input);
            }
            // Request Params attributes : End

            // Store metric parameters for use after span ends
            metricParams = {
              genAIEndpoint,
              model,
              user,
              cost,
              aiSystem: OpenAIWrapper.aiSystem,
            };

            return response;
          } catch (e: any) {
            OpenLitHelper.handleException(span, e);
          } finally {
            span.end();
            // Record metrics after span has ended if parameters are available
            if (metricParams) {
              BaseWrapper.recordMetrics(span, metricParams);
            }
          }
        });
      };
    };
  }
}

export default OpenAIWrapper;
