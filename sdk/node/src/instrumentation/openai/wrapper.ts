import { SpanKind, SpanStatusCode, Tracer, context, trace } from '@opentelemetry/api';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import SemanticConvention from '../../semantic-convention';
import { SDK_NAME, TELEMETRY_SDK_NAME } from '../../constant';

export default class OpenAIWrapper {
  static setBaseSpanAttributes(
    span: any,
    { genAIEndpoint, model, user, cost, environment, applicationName }: any
  ) {
    span.setAttributes({
      [TELEMETRY_SDK_NAME]: SDK_NAME,
    });

    span.setAttribute(TELEMETRY_SDK_NAME, SDK_NAME);
    span.setAttribute(SemanticConvention.GEN_AI_SYSTEM, SemanticConvention.GEN_AI_SYSTEM_OPENAI);
    span.setAttribute(SemanticConvention.GEN_AI_ENDPOINT, genAIEndpoint);
    span.setAttribute(SemanticConvention.GEN_AI_ENVIRONMENT, environment);
    span.setAttribute(SemanticConvention.GEN_AI_APPLICATION_NAME, applicationName);
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MODEL, model);
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_USER, user);
    if (cost !== undefined) span.setAttribute(SemanticConvention.GEN_AI_USAGE_COST, cost);

    span.setStatus({ code: SpanStatusCode.OK });
  }

  static _patchChatCompletionCreate(tracer: Tracer): any {
    const genAIEndpoint = 'openai.resources.chat.completions';
    const applicationName = OpenlitConfig.applicationName;
    const environment = OpenlitConfig.environment;
    const traceContent = OpenlitConfig.traceContent;
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const span = tracer.startSpan(genAIEndpoint, { kind: SpanKind.CLIENT });
        return context.with(trace.setSpan(context.active(), span), async () => {
          try {
            const response = await originalMethod.apply(this, args);
            const {
              messages,
              frequency_penalty = 0,
              max_tokens = null,
              n = 1,
              presence_penalty = 0,
              seed = null,
              temperature = 1,
              tools,
              top_p,
              user,
              stream = false,
            } = args[0];

            // Request Params attributes : Start
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_P, top_p || 1);
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, max_tokens);
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, temperature);
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY, presence_penalty);
            span.setAttribute(
              SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY,
              frequency_penalty
            );
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

            span.setAttribute(SemanticConvention.GEN_AI_TYPE, SemanticConvention.GEN_AI_TYPE_CHAT);
            span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_ID, response.id);

            const model = response.model || 'gpt-3.5-turbo';

            const pricingInfo = await OpenlitConfig.updatePricingJson(OpenlitConfig.pricing_json);

            // Calculate cost of the operation
            const cost = OpenLitHelper.getChatModelCost(
              model,
              pricingInfo,
              response.usage.prompt_tokens,
              response.usage.completion_tokens
            );

            OpenAIWrapper.setBaseSpanAttributes(span, {
              genAIEndpoint,
              model,
              user,
              cost,
              applicationName,
              environment,
            });

            if (!tools) {
              span.setAttribute(
                SemanticConvention.GEN_AI_USAGE_PROMPT_TOKENS,
                response.usage.prompt_tokens
              );
              span.setAttribute(
                SemanticConvention.GEN_AI_USAGE_COMPLETION_TOKENS,
                response.usage.completion_tokens
              );
              span.setAttribute(
                SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS,
                response.usage.total_tokens
              );
              span.setAttribute(
                SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON,
                response.choices[0].finish_reason
              );

              if (traceContent) {
                if (n === 1) {
                  span.setAttribute(
                    SemanticConvention.GEN_AI_CONTENT_COMPLETION,
                    response.choices[0].message.content
                  );
                } else {
                  let i = 0;
                  while (i < n) {
                    const attribute_name = `${SemanticConvention.GEN_AI_CONTENT_COMPLETION}.[i]`;
                    span.setAttribute(attribute_name, response.choices[i].message.content);
                    i += 1;
                  }
                }
              }
            } else {
              span.setAttribute(SemanticConvention.GEN_AI_CONTENT_COMPLETION, 'Function called with tools');
              span.setAttribute(
                SemanticConvention.GEN_AI_USAGE_PROMPT_TOKENS,
                response.usage.prompt_tokens
              );
              span.setAttribute(
                SemanticConvention.GEN_AI_USAGE_COMPLETION_TOKENS,
                response.usage.completion_tokens
              );
              span.setAttribute(
                SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS,
                response.usage.total_tokens
              );
            }

            return response;
          } catch (e: any) {
            OpenLitHelper.handleException(span, e);
          } finally {
            span.end();
          }
        });
      };
    };
  }

  static _patchEmbedding(tracer: Tracer): any {
    const genAIEndpoint = 'openai.resources.embeddings';
    const applicationName = OpenlitConfig.applicationName;
    const environment = OpenlitConfig.environment;
    const traceContent = OpenlitConfig.traceContent;

    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const span = tracer.startSpan(genAIEndpoint, { kind: SpanKind.CLIENT });
        return context.with(trace.setSpan(context.active(), span), async () => {
          try {
            const response = await originalMethod.apply(this, args);
            span.setAttributes({
              [TELEMETRY_SDK_NAME]: SDK_NAME,
            });

            const model = response.model || 'text-embedding-ada-002';
            const pricingInfo = await OpenlitConfig.updatePricingJson(OpenlitConfig.pricing_json);
            const cost = OpenLitHelper.getEmbedModelCost(
              model,
              pricingInfo,
              response.usage.prompt_tokens
            );

            span.setAttribute(
              SemanticConvention.GEN_AI_TYPE,
              SemanticConvention.GEN_AI_TYPE_EMBEDDING
            );

            const { dimensions, encoding_format = 'float', input, user } = args[0];
            // Set base span attribues
            OpenAIWrapper.setBaseSpanAttributes(span, {
              genAIEndpoint,
              model,
              user,
              cost,
              applicationName,
              environment,
            });

            // Request Params attributes : Start

            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_EMBEDDING_FORMAT, encoding_format);
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_EMBEDDING_DIMENSION, dimensions);
            if (traceContent) {
              span.setAttribute(SemanticConvention.GEN_AI_CONTENT_PROMPT, input);
            }
            // Request Params attributes : End

            span.setAttribute(
              SemanticConvention.GEN_AI_USAGE_PROMPT_TOKENS,
              response.usage.prompt_tokens
            );
            span.setAttribute(
              SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS,
              response.usage.total_tokens
            );

            return response;
          } catch (e: any) {
            OpenLitHelper.handleException(span, e);
          } finally {
            span.end();
          }
        });
      };
    };
  }

  static _patchFineTune(tracer: Tracer): any {
    const genAIEndpoint = 'openai.resources.fine_tuning.jobs';
    const applicationName = OpenlitConfig.applicationName;
    const environment = OpenlitConfig.environment;

    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const span = tracer.startSpan(genAIEndpoint, { kind: SpanKind.CLIENT });
        return context.with(trace.setSpan(context.active(), span), async () => {
          try {
            const response = await originalMethod.apply(this, args);
            span.setAttributes({
              [TELEMETRY_SDK_NAME]: SDK_NAME,
            });

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
              applicationName,
              environment,
            });

            span.setAttribute(
              SemanticConvention.GEN_AI_TYPE,
              SemanticConvention.GEN_AI_TYPE_FINETUNING
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
              SemanticConvention.GEN_AI_USAGE_PROMPT_TOKENS,
              response.usage.prompt_tokens
            );
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_FINETUNE_STATUS, response.status);

            return response;
          } catch (e: any) {
            OpenLitHelper.handleException(span, e);
          } finally {
            span.end();
          }
        });
      };
    };
  }

  static _patchImageGenerate(tracer: Tracer): any {
    const genAIEndpoint = 'openai.resources.images';
    const applicationName = OpenlitConfig.applicationName;
    const environment = OpenlitConfig.environment;
    const traceContent = OpenlitConfig.traceContent;
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const span = tracer.startSpan(genAIEndpoint, { kind: SpanKind.CLIENT });
        return context.with(trace.setSpan(context.active(), span), async () => {
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

            span.setAttribute(SemanticConvention.GEN_AI_TYPE, SemanticConvention.GEN_AI_TYPE_IMAGE);
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
              applicationName,
              environment,
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

            return response;
          } catch (e: any) {
            OpenLitHelper.handleException(span, e);
          } finally {
            span.end();
          }
        });
      };
    };
  }

  static _patchImageVariation(tracer: Tracer): any {
    const genAIEndpoint = 'openai.resources.images';
    const applicationName = OpenlitConfig.applicationName;
    const environment = OpenlitConfig.environment;
    const traceContent = OpenlitConfig.traceContent;
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const span = tracer.startSpan(genAIEndpoint, { kind: SpanKind.CLIENT });
        return context.with(trace.setSpan(context.active(), span), async () => {
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

            span.setAttribute(SemanticConvention.GEN_AI_TYPE, SemanticConvention.GEN_AI_TYPE_IMAGE);
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
              applicationName,
              environment,
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

            return response;
          } catch (e: any) {
            OpenLitHelper.handleException(span, e);
          } finally {
            span.end();
          }
        });
      };
    };
  }

  static _patchAudioCreate(tracer: Tracer): any {
    const genAIEndpoint = 'openai.resources.audio.speech';
    const applicationName = OpenlitConfig.applicationName;
    const environment = OpenlitConfig.environment;
    const traceContent = OpenlitConfig.traceContent;
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const span = tracer.startSpan(genAIEndpoint, { kind: SpanKind.CLIENT });
        return context.with(trace.setSpan(context.active(), span), async () => {
          try {
            const response = await originalMethod.apply(this, args);

            const { input, user, voice, response_format = 'mp3', speed = 1 } = args[0];

            span.setAttribute(SemanticConvention.GEN_AI_TYPE, SemanticConvention.GEN_AI_TYPE_AUDIO);

            const model = response.model || 'tts-1';

            const pricingInfo = await OpenlitConfig.updatePricingJson(OpenlitConfig.pricing_json);

            // Calculate cost of the operation
            const cost = OpenLitHelper.getAudioModelCost(model, pricingInfo, input);

            OpenAIWrapper.setBaseSpanAttributes(span, {
              genAIEndpoint,
              model,
              user,
              cost,
              applicationName,
              environment,
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

            return response;
          } catch (e: any) {
            OpenLitHelper.handleException(span, e);
          } finally {
            span.end();
          }
        });
      };
    };
  }
}
