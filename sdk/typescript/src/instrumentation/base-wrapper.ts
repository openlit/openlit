import OpenlitConfig from '../config';
import { SDK_NAME, TELEMETRY_SDK_NAME } from '../constant';
import SemanticConvention from '../semantic-convention';
import { Span, SpanStatusCode } from '@opentelemetry/api';
import Metrics from '../otel/metrics';

type BaseSpanAttributes = {
  genAIEndpoint: string;
  model: string;
  user?: unknown;
  cost?: number | string;
  aiSystem: string;
};

export default class BaseWrapper {
  static setBaseSpanAttributes(
    span: Span,
    { genAIEndpoint, model, user, cost, aiSystem }: BaseSpanAttributes
  ) {
    const applicationName = OpenlitConfig.applicationName!;
    const environment = OpenlitConfig.environment!;

    span.setAttributes({
      [TELEMETRY_SDK_NAME]: SDK_NAME,
    });

    span.setAttribute(TELEMETRY_SDK_NAME, SDK_NAME);
    span.setAttribute(SemanticConvention.GEN_AI_SYSTEM, aiSystem);
    span.setAttribute(SemanticConvention.GEN_AI_ENDPOINT, genAIEndpoint);
    span.setAttribute(SemanticConvention.GEN_AI_ENVIRONMENT, environment);
    span.setAttribute(SemanticConvention.GEN_AI_APPLICATION_NAME, applicationName);
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MODEL, model);
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_USER, typeof user === 'string' || typeof user === 'number' ? user : String(user ?? ''));
    if (cost !== undefined) {
      span.setAttribute(SemanticConvention.GEN_AI_USAGE_COST, cost);
    }
    span.setStatus({ code: SpanStatusCode.OK });

    const inputTokens = BaseWrapper.getSpanAttribute(span, SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS);
    const outputTokens = BaseWrapper.getSpanAttribute(span, SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS);
    const duration = BaseWrapper.getSpanAttribute(span, 'duration') ?? BaseWrapper.getSpanAttribute(span, 'gen_ai.duration');

    const attributes = {
      [SemanticConvention.GEN_AI_SYSTEM]: aiSystem,
      [SemanticConvention.GEN_AI_ENDPOINT]: genAIEndpoint,
      [SemanticConvention.GEN_AI_ENVIRONMENT]: environment,
      [SemanticConvention.GEN_AI_APPLICATION_NAME]: applicationName,
      [SemanticConvention.GEN_AI_REQUEST_MODEL]: model,
      [SemanticConvention.GEN_AI_REQUEST_USER]: typeof user === 'string' || typeof user === 'number' ? user : String(user ?? ''),
      ...(cost !== undefined ? { [SemanticConvention.GEN_AI_USAGE_COST]: cost } : {}),
    };
    Metrics.genaiRequests?.add(1, attributes);
    if (typeof inputTokens === 'number') Metrics.genaiPromptTokens?.add(inputTokens, attributes);
    if (typeof outputTokens === 'number') Metrics.genaiCompletionTokens?.add(outputTokens, attributes);
    if (typeof duration === 'number') Metrics.genaiClientOperationDuration?.record(duration, attributes);
    if (cost !== undefined) {
      const numericCost = typeof cost === 'number' ? cost : Number(cost);
      if (!isNaN(numericCost)) {
        Metrics.genaiCost?.record(numericCost, attributes);
      }
    }
  }

  static getSpanAttribute(span: Span, key: string): number | undefined {
    // @ts-expect-error: OpenTelemetry Span may have attributes property in some implementations
    return typeof span.attributes === 'object' ? span.attributes[key] : undefined;
  }
}
