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
    const metricsDict = OpenlitConfig.metricsDict;
    const applicationName = OpenlitConfig.applicationName;
    const disableMetrics = OpenlitConfig.disableMetrics;
    const environment = OpenlitConfig.environment;
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const span = tracer.startSpan(genAIEndpoint, { kind: SpanKind.CLIENT });
        return context.with(trace.setSpan(context.active(), span), async () => {
          try {
            const response = await originalMethod.apply(this, args);

            // Format 'messages' into a single string
            const messagePrompt = response.messages || '';
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
              user: response.user || '',
              cost,
              applicationName,
              environment,
            });
            console.log('asdnakjsdksjkd');

            // Set base span attribues

            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_P, response.top_p || 1);
            span.setAttribute(
              SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS,
              response.max_tokens || ''
            );
            span.setAttribute(
              SemanticConvention.GEN_AI_REQUEST_TEMPERATURE,
              response.temperature || 1
            );
            span.setAttribute(
              SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY,
              response.presence_penalty || 0
            );
            span.setAttribute(
              SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY,
              response.frequency_penalty || 0
            );
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_SEED, response.seed || '');
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, false);

            span.setAttribute(SemanticConvention.GEN_AI_CONTENT_PROMPT, prompt);

            // Set span attributes when tools is not passed to the function call
            if (!response.hasOwnProperty('tools')) {
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

              if (!response.hasOwnProperty('n') || response['n'] === 1) {
                span.setAttribute(
                  SemanticConvention.GEN_AI_CONTENT_COMPLETION,
                  response.choices[0].message.content
                );
              } else {
                let i = 0;
                while (i < response['n']) {
                  const attribute_name = `${SemanticConvention.GEN_AI_COMPLETION}.[i]`;
                  span.setAttribute(attribute_name, response.choices[i].message.content);
                  i += 1;
                }
              }
            } else {
              span.setAttribute(
                SemanticConvention.GEN_AI_CONTENT_COMPLETION,
                'Function called with tools'
              );
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

            if (!disableMetrics) {
              const attributes = {
                [TELEMETRY_SDK_NAME]: SDK_NAME,
                [SemanticConvention.GEN_AI_APPLICATION_NAME]: applicationName,
                [SemanticConvention.GEN_AI_SYSTEM]: SemanticConvention.GEN_AI_SYSTEM_OPENAI,
                [SemanticConvention.GEN_AI_ENVIRONMENT]: environment,
                [SemanticConvention.GEN_AI_TYPE]: SemanticConvention.GEN_AI_TYPE_CHAT,
                [SemanticConvention.GEN_AI_REQUEST_MODEL]: model,
              };

              if (
                metricsDict['genai_requests'] &&
                typeof metricsDict['genai_requests'].add === 'function'
              ) {
                metricsDict['genai_requests'].add(1, attributes);
              }

              if (
                metricsDict['genai_total_tokens'] &&
                typeof metricsDict['genai_total_tokens'].add === 'function'
              ) {
                metricsDict['genai_total_tokens'].add(response.usage.total_tokens, attributes);
              }

              if (
                metricsDict['genai_completion_tokens'] &&
                typeof metricsDict['genai_completion_tokens'].add === 'function'
              ) {
                metricsDict['genai_completion_tokens'].add(
                  response.usage.completion_tokens,
                  attributes
                );
              }

              if (
                metricsDict['genai_prompt_tokens'] &&
                typeof metricsDict['genai_prompt_tokens'].add === 'function'
              ) {
                metricsDict['genai_prompt_tokens'].add(response.usage.prompt_tokens, attributes);
              }

              if (
                metricsDict['genai_cost'] &&
                typeof metricsDict['genai_cost'].record === 'function'
              ) {
                metricsDict['genai_cost'].record(cost, attributes);
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

  static _patchEmbedding(tracer: Tracer): any {
    const genAIEndpoint = 'openai.resources.embeddings';
    const metricsDict = OpenlitConfig.metricsDict;
    const applicationName = OpenlitConfig.applicationName;
    const disableMetrics = OpenlitConfig.disableMetrics;
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

            // Set base span attribues
            OpenAIWrapper.setBaseSpanAttributes(span, {
              genAIEndpoint,
              model,
              user: response.user || '',
              cost,
              applicationName,
              environment,
            });

            span.setAttribute(
              SemanticConvention.GEN_AI_REQUEST_EMBEDDING_FORMAT,
              response.encoding_format || 'float'
            );
            span.setAttribute(
              SemanticConvention.GEN_AI_REQUEST_EMBEDDING_DIMENSION,
              response.dimensions
            );
            span.setAttribute(
              SemanticConvention.GEN_AI_USAGE_PROMPT_TOKENS,
              response.usage.prompt_tokens
            );
            span.setAttribute(
              SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS,
              response.usage.total_tokens
            );

            span.setAttribute(SemanticConvention.GEN_AI_CONTENT_PROMPT, response.input);

            if (!disableMetrics) {
              const attributes = {
                [TELEMETRY_SDK_NAME]: SDK_NAME,
                [SemanticConvention.GEN_AI_APPLICATION_NAME]: applicationName,
                [SemanticConvention.GEN_AI_SYSTEM]: SemanticConvention.GEN_AI_SYSTEM_OPENAI,
                [SemanticConvention.GEN_AI_ENVIRONMENT]: environment,
                [SemanticConvention.GEN_AI_TYPE]: SemanticConvention.GEN_AI_TYPE_EMBEDDING,
                [SemanticConvention.GEN_AI_REQUEST_MODEL]: model,
              };

              if (
                metricsDict['genai_requests'] &&
                typeof metricsDict['genai_requests'].add === 'function'
              ) {
                metricsDict['genai_requests'].add(1, attributes);
              }

              if (
                metricsDict['genai_total_tokens'] &&
                typeof metricsDict['genai_total_tokens'].add === 'function'
              ) {
                metricsDict['genai_total_tokens'].add(response.usage.total_tokens, attributes);
              }

              if (
                metricsDict['genai_prompt_tokens'] &&
                typeof metricsDict['genai_prompt_tokens'].add === 'function'
              ) {
                metricsDict['genai_prompt_tokens'].add(response.usage.prompt_tokens, attributes);
              }

              if (
                metricsDict['genai_cost'] &&
                typeof metricsDict['genai_cost'].record === 'function'
              ) {
                metricsDict['genai_cost'].record(cost, attributes);
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

  static _patchFineTune(tracer: Tracer): any {
    const genAIEndpoint = 'openai.resources.fine_tuning.jobs';
    const metricsDict = OpenlitConfig.metricsDict;
    const applicationName = OpenlitConfig.applicationName;
    const disableMetrics = OpenlitConfig.disableMetrics;
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

            // Set base span attribues
            OpenAIWrapper.setBaseSpanAttributes(span, {
              genAIEndpoint,
              model,
              user: response.user || '',
              applicationName,
              environment,
            });

            span.setAttribute(
              SemanticConvention.GEN_AI_TYPE,
              SemanticConvention.GEN_AI_TYPE_FINETUNING
            );

            span.setAttribute(
              SemanticConvention.GEN_AI_REQUEST_TRAINING_FILE,
              response.training_file || ''
            );
            span.setAttribute(
              SemanticConvention.GEN_AI_REQUEST_VALIDATION_FILE,
              response.validation_file || ''
            );
            span.setAttribute(
              SemanticConvention.GEN_AI_REQUEST_FINETUNE_BATCH_SIZE,
              response.hyperparameters?.batch_size || 'auto'
            );
            span.setAttribute(
              SemanticConvention.GEN_AI_REQUEST_FINETUNE_MODEL_LRM,
              response.hyperparameters?.learning_rate_multiplier || 'auto'
            );
            span.setAttribute(
              SemanticConvention.GEN_AI_REQUEST_FINETUNE_MODEL_EPOCHS,
              response.hyperparameters?.n_epochs || 'auto'
            );
            span.setAttribute(
              SemanticConvention.GEN_AI_REQUEST_FINETUNE_MODEL_SUFFIX,
              response.suffix || ''
            );
            span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_ID, response.id);
            span.setAttribute(
              SemanticConvention.GEN_AI_USAGE_PROMPT_TOKENS,
              response.usage.prompt_tokens
            );
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_FINETUNE_STATUS, response.status);

            if (!disableMetrics) {
              const attributes = {
                [TELEMETRY_SDK_NAME]: SDK_NAME,
                [SemanticConvention.GEN_AI_APPLICATION_NAME]: applicationName,
                [SemanticConvention.GEN_AI_SYSTEM]: SemanticConvention.GEN_AI_SYSTEM_OPENAI,
                [SemanticConvention.GEN_AI_ENVIRONMENT]: environment,
                [SemanticConvention.GEN_AI_TYPE]: SemanticConvention.GEN_AI_TYPE_FINETUNING,
                [SemanticConvention.GEN_AI_REQUEST_MODEL]: model,
              };

              if (
                metricsDict['genai_requests'] &&
                typeof metricsDict['genai_requests'].add === 'function'
              ) {
                metricsDict['genai_requests'].add(1, attributes);
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

  static _patchImageGenerate(tracer: Tracer): any {
    const genAIEndpoint = 'openai.resources.images';
    const metricsDict = OpenlitConfig.metricsDict;
    const applicationName = OpenlitConfig.applicationName;
    const disableMetrics = OpenlitConfig.disableMetrics;
    const environment = OpenlitConfig.environment;
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const span = tracer.startSpan(genAIEndpoint, { kind: SpanKind.CLIENT });
        return context.with(trace.setSpan(context.active(), span), async () => {
          try {
            const response = await originalMethod.apply(this, args);
            let imagesCount = 0;
            let image;

            if (
              response.hasOwnProperty('response_format') &&
              response.response_format === 'b64_json'
            ) {
              image = 'b64_json';
            } else {
              image = 'url';
            }

            span.setAttribute(SemanticConvention.GEN_AI_TYPE, SemanticConvention.GEN_AI_TYPE_IMAGE);
            span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_ID, response.created);

            const model = response.model || 'dall-e-2';
            const imageSize = response.size || '1024x1024';
            const imageQuality = response.quality || 'standard';
            const imageStyle = response.style || 'vivid';

            const pricingInfo = await OpenlitConfig.updatePricingJson(OpenlitConfig.pricing_json);

            // Calculate cost of the operation
            const cost =
              (response.data?.length || 1) *
              OpenLitHelper.getImageModelCost(model, pricingInfo, imageSize, imageQuality);

            OpenAIWrapper.setBaseSpanAttributes(span, {
              genAIEndpoint,
              model,
              user: response.user || '',
              cost,
              applicationName,
              environment,
            });

            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IMAGE_SIZE, imageSize);
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IMAGE_QUALITY, imageQuality);
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IMAGE_STYLE, imageStyle);

            span.setAttribute(SemanticConvention.GEN_AI_CONTENT_PROMPT, response.prompt || '');

            if (response.data) {
              for (const items of response.data) {
                span.setAttribute(
                  SemanticConvention.GEN_AI_CONTENT_REVISED_PROMPT,
                  items.revised_prompt || ''
                );

                const attributeName = `gen_ai.response.image.${imagesCount}`;
                span.setAttribute(attributeName, items[image]);

                imagesCount++;
              }
            }

            if (!disableMetrics) {
              const attributes = {
                [TELEMETRY_SDK_NAME]: SDK_NAME,
                [SemanticConvention.GEN_AI_APPLICATION_NAME]: applicationName,
                [SemanticConvention.GEN_AI_SYSTEM]: SemanticConvention.GEN_AI_SYSTEM_OPENAI,
                [SemanticConvention.GEN_AI_ENVIRONMENT]: environment,
                [SemanticConvention.GEN_AI_TYPE]: SemanticConvention.GEN_AI_TYPE_IMAGE,
                [SemanticConvention.GEN_AI_REQUEST_MODEL]: model,
              };

              if (
                metricsDict['genai_requests'] &&
                typeof metricsDict['genai_requests'].add === 'function'
              ) {
                metricsDict['genai_requests'].add(1, attributes);
              }

              if (
                metricsDict['genai_cost'] &&
                typeof metricsDict['genai_cost'].record === 'function'
              ) {
                metricsDict['genai_cost'].record(cost, attributes);
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
    const metricsDict = OpenlitConfig.metricsDict;
    const applicationName = OpenlitConfig.applicationName;
    const disableMetrics = OpenlitConfig.disableMetrics;
    const environment = OpenlitConfig.environment;
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const span = tracer.startSpan(genAIEndpoint, { kind: SpanKind.CLIENT });
        return context.with(trace.setSpan(context.active(), span), async () => {
          try {
            const response = await originalMethod.apply(this, args);
            let imagesCount = 0;
            let image;

            if (
              response.hasOwnProperty('response_format') &&
              response.response_format === 'b64_json'
            ) {
              image = 'b64_json';
            } else {
              image = 'url';
            }

            span.setAttribute(SemanticConvention.GEN_AI_TYPE, SemanticConvention.GEN_AI_TYPE_IMAGE);
            span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_ID, response.created);

            const model = response.model || 'dall-e-2';
            const imageSize = response.size || '1024x1024';
            const imageQuality = response.quality || 'standard';
            const imageStyle = response.style || 'vivid';

            const pricingInfo = await OpenlitConfig.updatePricingJson(OpenlitConfig.pricing_json);

            // Calculate cost of the operation
            const cost =
              (response.data?.length || 1) *
              OpenLitHelper.getImageModelCost(model, pricingInfo, imageSize, imageQuality);

            OpenAIWrapper.setBaseSpanAttributes(span, {
              genAIEndpoint,
              model,
              user: response.user || '',
              cost,
              applicationName,
              environment,
            });

            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IMAGE_SIZE, imageSize);
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IMAGE_QUALITY, imageQuality);
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IMAGE_STYLE, imageStyle);

            span.setAttribute(SemanticConvention.GEN_AI_CONTENT_PROMPT, response.prompt || '');

            if (response.data) {
              for (const items of response.data) {
                span.setAttribute(
                  SemanticConvention.GEN_AI_CONTENT_REVISED_PROMPT,
                  items.revised_prompt || ''
                );

                const attributeName = `gen_ai.response.image.${imagesCount}`;
                span.setAttribute(attributeName, items[image]);

                imagesCount++;
              }
            }

            if (!disableMetrics) {
              const attributes = {
                [TELEMETRY_SDK_NAME]: SDK_NAME,
                [SemanticConvention.GEN_AI_APPLICATION_NAME]: applicationName,
                [SemanticConvention.GEN_AI_SYSTEM]: SemanticConvention.GEN_AI_SYSTEM_OPENAI,
                [SemanticConvention.GEN_AI_ENVIRONMENT]: environment,
                [SemanticConvention.GEN_AI_TYPE]: SemanticConvention.GEN_AI_TYPE_IMAGE,
                [SemanticConvention.GEN_AI_REQUEST_MODEL]: model,
              };

              if (
                metricsDict['genai_requests'] &&
                typeof metricsDict['genai_requests'].add === 'function'
              ) {
                metricsDict['genai_requests'].add(1, attributes);
              }

              if (
                metricsDict['genai_cost'] &&
                typeof metricsDict['genai_cost'].record === 'function'
              ) {
                metricsDict['genai_cost'].record(cost, attributes);
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
    const metricsDict = OpenlitConfig.metricsDict;
    const applicationName = OpenlitConfig.applicationName;
    const disableMetrics = OpenlitConfig.disableMetrics;
    const environment = OpenlitConfig.environment;
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const span = tracer.startSpan(genAIEndpoint, { kind: SpanKind.CLIENT });
        return context.with(trace.setSpan(context.active(), span), async () => {
          try {
            const response = await originalMethod.apply(this, args);

            span.setAttribute(SemanticConvention.GEN_AI_TYPE, SemanticConvention.GEN_AI_TYPE_AUDIO);

            const model = response.model || 'tts-1';

            const pricingInfo = await OpenlitConfig.updatePricingJson(OpenlitConfig.pricing_json);

            // Calculate cost of the operation
            const cost = OpenLitHelper.getAudioModelCost(model, pricingInfo, response.input || '');

            OpenAIWrapper.setBaseSpanAttributes(span, {
              genAIEndpoint,
              model,
              user: response.user || '',
              cost,
              applicationName,
              environment,
            });

            span.setAttribute(
              SemanticConvention.GEN_AI_REQUEST_AUDIO_VOICE,
              response.voice || 'alloy'
            );
            span.setAttribute(
              SemanticConvention.GEN_AI_REQUEST_AUDIO_RESPONSE_FORMAT,
              response.response_format || 'mp3'
            );
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_AUDIO_SPEED, response.speed || 1);

            span.setAttribute(SemanticConvention.GEN_AI_CONTENT_PROMPT, response.input || '');

            if (!disableMetrics) {
              const attributes = {
                [TELEMETRY_SDK_NAME]: SDK_NAME,
                [SemanticConvention.GEN_AI_APPLICATION_NAME]: applicationName,
                [SemanticConvention.GEN_AI_SYSTEM]: SemanticConvention.GEN_AI_SYSTEM_OPENAI,
                [SemanticConvention.GEN_AI_ENVIRONMENT]: environment,
                [SemanticConvention.GEN_AI_TYPE]: SemanticConvention.GEN_AI_TYPE_AUDIO,
                [SemanticConvention.GEN_AI_REQUEST_MODEL]: model,
              };

              if (
                metricsDict['genai_requests'] &&
                typeof metricsDict['genai_requests'].add === 'function'
              ) {
                metricsDict['genai_requests'].add(1, attributes);
              }

              if (
                metricsDict['genai_cost'] &&
                typeof metricsDict['genai_cost'].record === 'function'
              ) {
                metricsDict['genai_cost'].record(cost, attributes);
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
}
