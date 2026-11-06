import OpenlitConfig from '../config';
import { SDK_NAME, SDK_VERSION } from '../constant';
import { ATTR_SERVICE_NAME, ATTR_TELEMETRY_SDK_NAME } from '@opentelemetry/semantic-conventions';
import SemanticConvention from '../semantic-convention';
import { Attributes, Span, SpanStatusCode } from '@opentelemetry/api';
import Metrics from '../otel/metrics';
import { applyCustomSpanAttributes } from '../helpers';

export type BaseSpanAttributes = {
  genAIEndpoint: string;
  model: string;
  user?: unknown;
  cost?: number | string;
  aiSystem: string;
  serverAddress?: string;
  serverPort?: number;
  errorType?: string;
};

type ApiPromiseObserver = {
  onResult: (result: any) => any;
  onError: (error: any) => void;
  /** The caller read the raw response, so `onResult` will never run. */
  onRawResponse: () => void;
};

/**
 * Observe a call to a Stainless-generated client without changing what the
 * caller receives. Those clients return an `APIPromise`, a Promise that also has
 * `withResponse()`, `asResponse()` and `_thenUnwrap()`, and the clients' own
 * helpers depend on them. Anything else (older clients, test doubles) is treated
 * as an ordinary thenable.
 */
export function observeApiPromise(pending: any, observer: ApiPromiseObserver): any {
  const { onResult, onError, onRawResponse } = observer;
  if (typeof pending?._thenUnwrap !== 'function' || typeof pending?.asResponse !== 'function') {
    return Promise.resolve(pending).then(onResult, (e: any) => {
      onError(e);
      throw e;
    });
  }

  const observed = pending._thenUnwrap(onResult);
  const asResponse = observed.asResponse;
  let parsing = false;
  let rawRequested = false;

  // Everything that reads the parsed result marks it, so the raw path below only
  // ever ends the span of a caller who took the response alone.
  for (const method of ['then', 'parse', 'withResponse', '_thenUnwrap']) {
    const original = observed[method];
    observed[method] = function (this: any, ...args: any[]) {
      parsing = true;
      return original.apply(this, args);
    };
  }
  observed.asResponse = function (this: any, ...args: any[]) {
    const raw = asResponse.apply(this, args);
    if (parsing) return raw;
    rawRequested = true;
    return raw.then((response: any) => {
      if (!parsing) onRawResponse();
      return response;
    });
  };

  // `asResponse()` shares the request's promise and leaves the body unread, so it
  // reports request failures without forcing a parse. `_thenUnwrap` is lazy: a
  // call nobody awaits would never end its span, so by the time the response
  // arrives, with the caller's synchronous chaining done, parse it for them.
  pending.asResponse().then(() => {
    if (!parsing && !rawRequested) observed.then(undefined, () => undefined);
  }, onError);

  return observed;
}

export default class BaseWrapper {
  static setBaseSpanAttributes(
    span: Span,
    { genAIEndpoint: _genAIEndpoint, model, user, cost, aiSystem, serverAddress, serverPort }: BaseSpanAttributes
  ) {
    const applicationName = OpenlitConfig.applicationName;
    const environment = OpenlitConfig.environment;

    if (!applicationName) {
      throw new Error("[Openlit] OpenlitConfig.applicationName is not set. Please check your configuration.");
    }
    if (!environment) {
      throw new Error("[Openlit] OpenlitConfig.environment is not set. Please check your configuration.");
    }


    span.setAttribute(ATTR_TELEMETRY_SDK_NAME, SDK_NAME);
    span.setAttribute(SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL, aiSystem);
    span.setAttribute(SemanticConvention.ATTR_DEPLOYMENT_ENVIRONMENT, environment);
    span.setAttribute(ATTR_SERVICE_NAME, applicationName);
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MODEL, model);
    span.setAttribute(SemanticConvention.GEN_AI_SDK_VERSION, SDK_VERSION);
    if (serverAddress) {
      span.setAttribute(SemanticConvention.SERVER_ADDRESS, serverAddress);
    }
    if (serverPort !== undefined) {
      span.setAttribute(SemanticConvention.SERVER_PORT, serverPort);
    }
    if (typeof user === 'string' || typeof user === 'number') {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_USER, user);
    }
    if (cost !== undefined) {
      span.setAttribute(SemanticConvention.GEN_AI_USAGE_COST, cost);
    }
    applyCustomSpanAttributes(span);
    span.setStatus({ code: SpanStatusCode.OK });
  }

  static recordMetrics(span: Span, baseAttributes: BaseSpanAttributes) {
    const applicationName = OpenlitConfig.applicationName!;
    const environment = OpenlitConfig.environment!;
    const { model, aiSystem, cost, errorType } = baseAttributes;

    const inputTokens = BaseWrapper.getSpanAttribute(span, SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS);
    const outputTokens = BaseWrapper.getSpanAttribute(span, SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS);
    const duration = BaseWrapper.getSpanAttribute(span, 'duration') ?? BaseWrapper.getSpanAttribute(span, SemanticConvention.GEN_AI_DURATION_LEGACY);
    const operationName = BaseWrapper.getSpanAttribute(span, SemanticConvention.GEN_AI_OPERATION) as unknown as string;
    const responseModel = BaseWrapper.getSpanAttribute(span, SemanticConvention.GEN_AI_RESPONSE_MODEL) as unknown as string;
    const serverAddress = BaseWrapper.getSpanAttribute(span, SemanticConvention.SERVER_ADDRESS) as unknown as string;
    const serverPort = BaseWrapper.getSpanAttribute(span, SemanticConvention.SERVER_PORT) as unknown as number;
    const attributes: Attributes = {
      [ATTR_TELEMETRY_SDK_NAME]: SDK_NAME,
      [ATTR_SERVICE_NAME]: applicationName,
      [SemanticConvention.ATTR_DEPLOYMENT_ENVIRONMENT]: environment,
      [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: aiSystem,
      [SemanticConvention.GEN_AI_REQUEST_MODEL]: model,
    };
    if (operationName) attributes[SemanticConvention.GEN_AI_OPERATION] = operationName;
    if (responseModel) attributes[SemanticConvention.GEN_AI_RESPONSE_MODEL] = responseModel;
    if (serverAddress) attributes[SemanticConvention.SERVER_ADDRESS] = serverAddress;
    if (serverPort !== undefined) attributes[SemanticConvention.SERVER_PORT] = serverPort;
    if (errorType) attributes[SemanticConvention.ERROR_TYPE] = errorType;

    if (Number.isFinite(inputTokens)) {
      Metrics.genaiClientUsageTokens?.record(inputTokens as number, {
        ...attributes,
        [SemanticConvention.GEN_AI_TOKEN_TYPE]: SemanticConvention.GEN_AI_TOKEN_TYPE_INPUT,
      });
    }
    if (Number.isFinite(outputTokens)) {
      Metrics.genaiClientUsageTokens?.record(outputTokens as number, {
        ...attributes,
        [SemanticConvention.GEN_AI_TOKEN_TYPE]: SemanticConvention.GEN_AI_TOKEN_TYPE_OUTPUT,
      });
    }
    if (Number.isFinite(duration)) {
      Metrics.genaiClientOperationDuration?.record((duration as number) / 1e9, attributes);
    }
    const tbt = BaseWrapper.getSpanAttribute(span, SemanticConvention.GEN_AI_SERVER_TBT);
    if (Number.isFinite(tbt)) Metrics.genaiServerTbt?.record(tbt as number, attributes);
    const ttft = BaseWrapper.getSpanAttribute(span, SemanticConvention.GEN_AI_SERVER_TTFT);
    if (Number.isFinite(ttft)) Metrics.genaiServerTtft?.record(ttft as number, attributes);
    if (Number.isFinite(ttft) && (ttft as number) > 0) {
      Metrics.genaiClientTimeToFirstChunk?.record(ttft as number, attributes);
    }
    if (Number.isFinite(tbt) && (tbt as number) > 0) {
      Metrics.genaiClientTimePerOutputChunk?.record(tbt as number, attributes);
      const outputTokensVal = Number.isFinite(outputTokens) ? (outputTokens as number) : 0;
      const serverRequestDuration = (ttft as number) + (tbt as number) * Math.max(outputTokensVal - 1, 0);
      Metrics.genaiServerRequestDuration?.record(serverRequestDuration, attributes);
    }
    if (cost !== undefined) {
      const numericCost = typeof cost === 'number' ? cost : Number(cost);
      if (Number.isFinite(numericCost)) {
        Metrics.genaiCost?.record(numericCost, attributes);
      }
    }  
  }

  static getSpanAttribute(span: Span, key: string): number | undefined {
    if (key === 'duration') {
      // Use duration if present, even if 0
      const s = span as { 
        duration?: number; 
        _duration?: number; 
        endTime?: [number, number]; 
        startTime?: [number, number]; 
        attributes?: Record<string, unknown> 
      };
      
      if (s.attributes && typeof s.attributes.duration !== 'undefined') {
        const attrDuration = s.attributes.duration;
        if (typeof attrDuration === 'number' && !isNaN(attrDuration)) {
          return attrDuration;
        }
      }
      
      if (typeof s.duration === 'number' && !isNaN(s.duration)) return s.duration;
      if (typeof s._duration === 'number' && !isNaN(s._duration)) return s._duration;
      
      if (s.endTime && s.startTime) {
        const [endSec, endNano] = s.endTime;
        const [startSec, startNano] = s.startTime;
        const end = endSec * 1e9 + endNano;
        const start = startSec * 1e9 + startNano;
        if (end > start) {
          return end - start;
        }
      }
      return undefined;
    }
    // @ts-expect-error: OpenTelemetry Span may have attributes property in some implementations
    return typeof span.attributes === 'object' ? span.attributes[key] : undefined;
  }
}
