import { SpanKind, SpanStatusCode, Tracer, context, trace } from '@opentelemetry/api';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import SemanticConvention from '../../semantic-convention';
import { SDK_NAME, TELEMETRY_SDK_NAME } from '../../constant';

export default class AnthropicWrapper {
  static setBaseSpanAttributes(
    span: any,
    { genAIEndpoint, model, user, cost, environment, applicationName }: any
  ) {
    span.setAttributes({
      [TELEMETRY_SDK_NAME]: SDK_NAME,
    });

    span.setAttribute(TELEMETRY_SDK_NAME, SDK_NAME);
    span.setAttribute(SemanticConvention.GEN_AI_SYSTEM, SemanticConvention.GEN_AI_SYSTEM_ANTHROPIC);
    span.setAttribute(SemanticConvention.GEN_AI_ENDPOINT, genAIEndpoint);
    span.setAttribute(SemanticConvention.GEN_AI_ENVIRONMENT, environment);
    span.setAttribute(SemanticConvention.GEN_AI_APPLICATION_NAME, applicationName);
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MODEL, model);
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_USER, user);
    if (cost !== undefined) span.setAttribute(SemanticConvention.GEN_AI_USAGE_COST, cost);

    span.setStatus({ code: SpanStatusCode.OK });
  }

  static _patchMessageCreate(tracer: Tracer): any {
    const genAIEndpoint = 'anthropic.resources.messages';
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

            const model = response.model || 'claude-3-sonnet-20240229';

            const pricingInfo = await OpenlitConfig.updatePricingJson(OpenlitConfig.pricing_json);

            // Calculate cost of the operation
            const cost = OpenLitHelper.getChatModelCost(
              model,
              pricingInfo,
              response.usage.input_tokens,
              response.usage.output_tokens
            );

            AnthropicWrapper.setBaseSpanAttributes(span, {
              genAIEndpoint,
              model,
              user: response.user || '',
              cost,
              applicationName,
              environment,
            });

            // Set base span attribues

            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_P, response.top_p || '');
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_K, response.top_k || '');
            span.setAttribute(
              SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS,
              response.max_tokens || -1
            );
            span.setAttribute(
              SemanticConvention.GEN_AI_REQUEST_TEMPERATURE,
              response.temperature || 1
            );

            span.setAttribute(
              SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON,
              response.stop_reason || ''
            );
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, false);

            span.setAttribute(SemanticConvention.GEN_AI_CONTENT_PROMPT, prompt);

            span.setAttribute(
              SemanticConvention.GEN_AI_USAGE_PROMPT_TOKENS,
              response.usage.input_tokens
            );
            span.setAttribute(
              SemanticConvention.GEN_AI_USAGE_COMPLETION_TOKENS,
              response.usage.output_tokens
            );
            span.setAttribute(
              SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS,
              response.usage.input_tokens + response.usage.output_tokens
            );

            span.setAttribute(
              SemanticConvention.GEN_AI_CONTENT_COMPLETION,
              response.content?.[0]?.text || ''
            );

            if (!disableMetrics) {
              const attributes = {
                [TELEMETRY_SDK_NAME]: SDK_NAME,
                [SemanticConvention.GEN_AI_APPLICATION_NAME]: applicationName,
                [SemanticConvention.GEN_AI_SYSTEM]: SemanticConvention.GEN_AI_SYSTEM_ANTHROPIC,
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
                metricsDict['genai_total_tokens'].add(
                  response.usage.input_tokens + response.usage.output_tokens,
                  attributes
                );
              }

              if (
                metricsDict['genai_completion_tokens'] &&
                typeof metricsDict['genai_completion_tokens'].add === 'function'
              ) {
                metricsDict['genai_completion_tokens'].add(
                  response.usage.output_tokens,
                  attributes
                );
              }

              if (
                metricsDict['genai_prompt_tokens'] &&
                typeof metricsDict['genai_prompt_tokens'].add === 'function'
              ) {
                metricsDict['genai_prompt_tokens'].add(response.usage.input_tokens, attributes);
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
