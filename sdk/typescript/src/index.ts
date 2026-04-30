import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_TELEMETRY_SDK_NAME } from '@opentelemetry/semantic-conventions';
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { OpenlitOptions, ResolvedOptions } from './types';
import Tracing from './otel/tracing';
import Events from './otel/events';
import { DEFAULT_APPLICATION_NAME, DEFAULT_ENVIRONMENT, SDK_NAME } from './constant';
import BaseOpenlit from './features/base';
import OpenlitConfig from './config';
import OpenLitHelper from './helpers';
import { usingAttributes, injectAdditionalAttributes } from './helpers';
import { Hallucination, Bias, Toxicity, All } from './evals';
import Metrics from './otel/metrics';
import SemanticConvention from './semantic-convention';
import { PromptInjection } from './guard/prompt-injection';
import { SensitiveTopic } from './guard/sensitive-topic';
import { TopicRestriction } from './guard/topic-restriction';
import { All as GuardAll } from './guard/all';
import { parseBoolEnv } from './otel/utils';

const evals = {
  Hallucination: (options: ConstructorParameters<typeof Hallucination>[0]) =>
    new Hallucination(options),
  Bias: (options: ConstructorParameters<typeof Bias>[0]) => new Bias(options),
  Toxicity: (options: ConstructorParameters<typeof Toxicity>[0]) => new Toxicity(options),
  All: (options: ConstructorParameters<typeof All>[0]) => new All(options),
};

const guard = {
  PromptInjection: (options: ConstructorParameters<typeof PromptInjection>[0]) => new PromptInjection(options),
  SensitiveTopic: (options: ConstructorParameters<typeof SensitiveTopic>[0]) => new SensitiveTopic(options),
  TopicRestriction: (options: ConstructorParameters<typeof TopicRestriction>[0]) => new TopicRestriction(options),
  All: (options: ConstructorParameters<typeof GuardAll>[0]) => new GuardAll(options),
};

/**
 * Resolve OpenlitOptions into a single ResolvedOptions object.
 * Precedence: arg > env var > default.
 */
function resolveOptions(options?: OpenlitOptions): ResolvedOptions {
  const o = options || {};

  const environment = o.environment ?? DEFAULT_ENVIRONMENT;
  const applicationName = o.applicationName ?? DEFAULT_APPLICATION_NAME;

  const rawEndpoint =
    o.otlpEndpoint ??
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
    undefined;

  const otlpEndpoint = rawEndpoint
    ? rawEndpoint.replace(/\/v1\/traces$/, '')
    : undefined;

  let otlpHeaders = o.otlpHeaders ?? undefined;
  if (!otlpHeaders && process.env.OTEL_EXPORTER_OTLP_HEADERS) {
    otlpHeaders = process.env.OTEL_EXPORTER_OTLP_HEADERS.split(',').reduce(
      (acc: Record<string, string>, item: string) => {
        const keyVal = item.split('=');
        acc[keyVal[0]] = keyVal[1];
        return acc;
      },
      {} as Record<string, string>
    );
  }
  if (!otlpHeaders) otlpHeaders = {};

  let disableBatch = o.disableBatch ?? undefined;
  const envDisableBatch = parseBoolEnv('OPENLIT_DISABLE_BATCH');
  if (disableBatch === undefined) {
    disableBatch = envDisableBatch ?? false;
  }

  let captureMessageContent = o.captureMessageContent ?? undefined;
  const envCapture = parseBoolEnv('OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT');
  if (captureMessageContent === undefined) {
    captureMessageContent = envCapture ?? true;
  }

  let disableMetrics = o.disableMetrics ?? undefined;
  const envDisableMetrics = parseBoolEnv('OPENLIT_DISABLE_METRICS');
  if (disableMetrics === undefined) {
    disableMetrics = envDisableMetrics ?? false;
  }

  let disableEvents = o.disableEvents ?? undefined;
  const envDisableEvents = parseBoolEnv('OPENLIT_DISABLE_EVENTS');
  if (disableEvents === undefined) {
    disableEvents = envDisableEvents ?? false;
  }

  return {
    environment,
    applicationName,
    tracer: o.tracer,
    otlpEndpoint,
    otlpHeaders,
    disableBatch,
    captureMessageContent,
    disabledInstrumentors: o.disabledInstrumentors,
    instrumentations: o.instrumentations,
    disableMetrics,
    disableEvents,
    pricingJson: o.pricingJson,
    maxContentLength: o.maxContentLength ?? null,
    customSpanAttributes: o.customSpanAttributes ?? null,
  };
}

class Openlit extends BaseOpenlit {
  static resource: ReturnType<typeof resourceFromAttributes>;
  static options: ResolvedOptions;
  static evals = evals;
  static guard = guard;

  static init(options?: OpenlitOptions) {
    try {
      // Enable OTel diagnostic logging so exporter errors (connection refused,
      // 404, timeouts) are surfaced to the user — matches Python SDK behavior.
      diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);

      const resolved = resolveOptions(options);
      this.options = resolved;

      this.resource = resourceFromAttributes({
        [ATTR_SERVICE_NAME]: resolved.applicationName,
        [SemanticConvention.ATTR_DEPLOYMENT_ENVIRONMENT]: resolved.environment,
        [ATTR_TELEMETRY_SDK_NAME]: SDK_NAME,
      });

      const setupBase = {
        ...resolved,
        resource: this.resource,
      };

      Tracing.setup(setupBase);

      if (!resolved.disableEvents) {
        Events.setup(setupBase);
      }

      if (!resolved.disableMetrics) {
        const exportIntervalMillis =
          Number(process.env.OTEL_EXPORTER_OTLP_METRICS_EXPORT_INTERVAL ?? 60000) || 60000;

        Metrics.setup({
          ...setupBase,
          exportIntervalMillis,
        });
      }

      // Fetch pricing info once and cache — matches Python SDK behavior.
      OpenLitHelper.fetchPricingInfo(resolved.pricingJson).then(
        (info) => { OpenlitConfig.pricingInfo = info; },
        () => { OpenlitConfig.pricingInfo = {}; }
      );
    } catch (e) {
      console.log('Connection time out', e);
    }
  }
}

const openlit = Openlit as typeof Openlit & {
  evals: typeof evals;
  guard: typeof guard;
  usingAttributes: typeof usingAttributes;
  injectAdditionalAttributes: typeof injectAdditionalAttributes;
};

(openlit as any).usingAttributes = usingAttributes;
(openlit as any).injectAdditionalAttributes = injectAdditionalAttributes;

export default openlit;
export { Openlit, usingAttributes, injectAdditionalAttributes };
export type { OpenlitOptions } from './types';
