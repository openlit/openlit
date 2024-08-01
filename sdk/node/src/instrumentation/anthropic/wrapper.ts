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
              max_tokens = null,
              seed = null,
              temperature = 1,
              top_p,
              top_k,
              user,
              stream = false,
              stop_reason,
            } = args[0];

            // Format 'messages' into a single string
            const messagePrompt = messages || '';
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
              user,
              cost,
              applicationName,
              environment,
            });

            // Request Params attributes : Start
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_P, top_p);
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_K, top_k);
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, max_tokens);
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, temperature);

            span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, stop_reason);
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, stream);
            span.setAttribute(SemanticConvention.GEN_AI_REQUEST_SEED, seed);
            if (traceContent) {
              span.setAttribute(SemanticConvention.GEN_AI_CONTENT_PROMPT, prompt);
            }
            // Request Params attributes : End

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
