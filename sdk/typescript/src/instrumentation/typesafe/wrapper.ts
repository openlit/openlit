import { Span, SpanKind, Tracer, context, trace, Attributes } from '@opentelemetry/api';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import SemanticConvention from '../../semantic-convention';
import BaseWrapper from '../base-wrapper';

const DEFAULT_MODEL = 'jev-latest';
const DEFAULT_SERVER_ADDRESS = 'api.typesafe.ai';
const DEFAULT_SERVER_PORT = 443;

function questionType(question: any): string {
  if (!question) return '';
  if (typeof question === 'object' && question.type) return String(question.type);
  return '';
}

function parseServer(client: any): { address: string; port: number } {
  const raw = client?.baseURL || client?.baseUrl || `https://${DEFAULT_SERVER_ADDRESS}`;
  try {
    const url = new URL(String(raw));
    const port = url.port
      ? Number(url.port)
      : url.protocol === 'http:'
        ? 80
        : DEFAULT_SERVER_PORT;
    return { address: url.hostname || DEFAULT_SERVER_ADDRESS, port };
  } catch {
    return { address: DEFAULT_SERVER_ADDRESS, port: DEFAULT_SERVER_PORT };
  }
}

function typesafeSdkVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('@typesafe-ai/sdk/package.json').version;
  } catch {
    return 'unknown';
  }
}

class TypeSafeWrapper extends BaseWrapper {
  static aiSystem = SemanticConvention.GEN_AI_SYSTEM_TYPESAFE;

  static _patchSystemOne(tracer: Tracer): any {
    const genAIEndpoint = 'typesafe.system_one';
    return (originalMethod: (...args: any[]) => any) => {
      return function wrappedSystemOne(this: any, ...args: any[]) {
        const request = args[0] || {};
        const questions = request.questions || {};
        const requestModel = request.model || this?.defaultModel || DEFAULT_MODEL;
        const { address, port } = parseServer(this);
        const questionIds = Object.keys(questions);
        const questionTypes = questionIds.map((id) => questionType(questions[id]) || 'unknown');
        // OTel GenAI: `{gen_ai.operation.name} {gen_ai.request.model}`
        const spanName = `${SemanticConvention.GEN_AI_OPERATION_TYPE_DECISION} ${requestModel}`;
        const startTime = Date.now();
        const span = tracer.startSpan(spanName, {
          kind: SpanKind.CLIENT,
          attributes: {
            [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_DECISION,
            [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: TypeSafeWrapper.aiSystem,
            [SemanticConvention.GEN_AI_REQUEST_MODEL]: requestModel,
            [SemanticConvention.SERVER_ADDRESS]: address,
            [SemanticConvention.SERVER_PORT]: port,
            [SemanticConvention.GEN_AI_REQUEST_STREAM]: false,
          },
        });
        span.setAttribute(SemanticConvention.GEN_AI_REQUEST_STREAM, false);
        span.setAttribute(SemanticConvention.TYPESAFE_API_TYPE, 'system_one');
        span.setAttribute(SemanticConvention.TYPESAFE_QUESTION_COUNT, questionIds.length);
        span.setAttribute(SemanticConvention.TYPESAFE_QUESTION_IDS, questionIds.join(','));
        span.setAttribute(SemanticConvention.TYPESAFE_QUESTION_TYPES, questionTypes.join(','));
        span.setAttribute(SemanticConvention.GEN_AI_SDK_VERSION, typesafeSdkVersion());

        return context
          .with(trace.setSpan(context.active(), span), async () => {
            return originalMethod.apply(this, args);
          })
          .then((response: any) => {
            return TypeSafeWrapper._systemOne({
              args,
              genAIEndpoint,
              response,
              span,
              requestModel,
              serverAddress: address,
              serverPort: port,
              startTime,
            });
          })
          .catch((e: any) => {
            OpenLitHelper.handleException(span, e);
            BaseWrapper.recordMetrics(span, {
              genAIEndpoint,
              model: requestModel,
              aiSystem: TypeSafeWrapper.aiSystem,
              serverAddress: address,
              serverPort: port,
              errorType: e?.constructor?.name || '_OTHER',
            });
            span.end();
            throw e;
          });
      };
    };
  }

  static async _systemOne({
    args,
    genAIEndpoint,
    response,
    span,
    requestModel,
    serverAddress,
    serverPort,
    startTime,
  }: {
    args: any[];
    genAIEndpoint: string;
    response: any;
    span: Span;
    requestModel: string;
    serverAddress: string;
    serverPort: number;
    startTime: number;
  }): Promise<any> {
    let metricParams;
    try {
      metricParams = TypeSafeWrapper._systemOneSetter({
        args,
        genAIEndpoint,
        result: response,
        span,
        requestModel,
        serverAddress,
        serverPort,
        startTime,
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

  static _systemOneSetter({
    args,
    genAIEndpoint,
    result,
    span,
    requestModel,
    serverAddress,
    serverPort,
    startTime,
  }: {
    args: any[];
    genAIEndpoint: string;
    result: any;
    span: Span;
    requestModel: string;
    serverAddress: string;
    serverPort: number;
    startTime: number;
  }) {
    const request = args[0] || {};
    const captureContent = OpenlitConfig.captureMessageContent;
    const responseModel = result?.model || requestModel;
    const requestId = result?.request_id || result?.requestId || result?.id;
    const inputTokens = result?.usage?.input_tokens;
    const outputTokens = result?.usage?.output_tokens;
    const ttft = Math.max((Date.now() - startTime) / 1000, 0);

    span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, SemanticConvention.GEN_AI_OUTPUT_TYPE_JSON);
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_STREAM, false);
    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, responseModel);
    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, ['stop']);
    span.setAttribute(SemanticConvention.GEN_AI_SERVER_TTFT, ttft);
    span.setAttribute(SemanticConvention.GEN_AI_SERVER_TBT, 0);
    if (requestId) {
      span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_ID, requestId);
    }
    if (inputTokens != null) {
      span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
    }
    if (outputTokens != null) {
      span.setAttribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, outputTokens);
    }
    if (inputTokens != null || outputTokens != null) {
      span.setAttribute(
        SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE,
        (inputTokens ?? 0) + (outputTokens ?? 0)
      );
    }

    const pricingInfo = OpenlitConfig.pricingInfo || {};
    const hasTokens = inputTokens != null || outputTokens != null;
    const cost = hasTokens
      ? OpenLitHelper.getChatModelCost(
          requestModel,
          pricingInfo,
          inputTokens ?? 0,
          outputTokens ?? 0
        )
      : undefined;

    TypeSafeWrapper.setBaseSpanAttributes(span, {
      genAIEndpoint,
      model: requestModel,
      cost,
      aiSystem: TypeSafeWrapper.aiSystem,
      serverAddress,
      serverPort,
    });
    span.setAttribute(SemanticConvention.GEN_AI_SDK_VERSION, typesafeSdkVersion());

    const inputPayload = JSON.stringify({
      state: request.state,
      questions: request.questions,
    });
    const outputPayload = JSON.stringify(result?.answers ?? {});
    const inputMessages = [
      { role: 'user', parts: [{ type: 'text', content: inputPayload }] },
    ];
    const outputMessages = [
      {
        role: 'assistant',
        parts: [{ type: 'text', content: outputPayload }],
        finish_reason: 'stop',
      },
    ];

    if (captureContent) {
      span.setAttribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, JSON.stringify(inputMessages));
      span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_MESSAGES, JSON.stringify(outputMessages));
    }

    if (!OpenlitConfig.disableEvents) {
      const eventAttrs: Attributes = {
        [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_DECISION,
        [SemanticConvention.GEN_AI_REQUEST_MODEL]: requestModel,
        [SemanticConvention.GEN_AI_RESPONSE_MODEL]: responseModel,
        [SemanticConvention.SERVER_ADDRESS]: serverAddress,
        [SemanticConvention.SERVER_PORT]: serverPort,
        [SemanticConvention.GEN_AI_OUTPUT_TYPE]: SemanticConvention.GEN_AI_OUTPUT_TYPE_JSON,
      };
      if (requestId) eventAttrs[SemanticConvention.GEN_AI_RESPONSE_ID] = requestId;
      if (inputTokens != null) {
        eventAttrs[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] = inputTokens;
      }
      if (outputTokens != null) {
        eventAttrs[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] = outputTokens;
      }
      if (captureContent) {
        eventAttrs[SemanticConvention.GEN_AI_INPUT_MESSAGES] = JSON.stringify(inputMessages);
        eventAttrs[SemanticConvention.GEN_AI_OUTPUT_MESSAGES] = JSON.stringify(outputMessages);
      }
      OpenLitHelper.emitInferenceEvent(span, eventAttrs);
    }

    return {
      genAIEndpoint,
      model: requestModel,
      cost,
      aiSystem: TypeSafeWrapper.aiSystem,
      serverAddress,
      serverPort,
    };
  }
}

export default TypeSafeWrapper;
