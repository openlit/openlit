import OpenlitConfig from '../config';
import { SDK_NAME, TELEMETRY_SDK_NAME } from '../constant';
import SemanticConvention from '../semantic-convention';
import { Span, SpanStatusCode } from '@opentelemetry/api';

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
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_USER, user as any);
    if (cost !== undefined) {
      span.setAttribute(SemanticConvention.GEN_AI_USAGE_COST, cost);
    }

    span.setStatus({ code: SpanStatusCode.OK });
  }
}
