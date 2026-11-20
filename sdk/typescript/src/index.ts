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
import {
  usingAttributes,
  injectAdditionalAttributes,
  withTags,
  setAgentVersion,
  resetAgentVersion,
  runWithAgentVersion,
  getCurrentAgentVersion,
} from './helpers';
import { runEval, runEvalBatch, fetchEvalTypes } from './evals';
import { logScore } from './score';
import { TracedSpan, startTrace, trace as traceManual } from './manual-trace';
import { LlmSpan, llm } from './llm-call';
import { instrument } from './instrument-client';
import { instrumentFetch } from './instrumentation/fetch';
import { extract, inject, recordSpan, traceContextFrom, withParent } from './trace-context';
import { createLambdaWrapper, createWorkerWrapper, withinBudget } from './runtime-wrappers';
import { codingAgentEnv } from './coding-agent';
import { IS_EDGE_BUILD, pricingSnapshot } from './platform';
import Metrics from './otel/metrics';
import GpuMetricsCollector from './instrumentation/gpu';
import SemanticConvention from './semantic-convention';
import { parseBoolEnv, parseOtlpHeaders } from './otel/utils';
import { setupAutoGuards } from './guard/integration';
import { PII } from './guard/pii';
import { PromptInjection } from './guard/prompt-injection';
import { Moderation } from './guard/moderation';
import { SensitiveTopic } from './guard/sensitive-topic';
import { TopicRestriction } from './guard/topic-restriction';
import { Schema } from './guard/schema';
import { Custom } from './guard/custom';
import { Pipeline } from './guard/pipeline';
import {
  Guard,
  GuardAction,
  GuardPhase,
  GuardError,
  GuardDeniedError,
  GuardTimeoutError,
  GuardConfigError,
  PipelineResult,
} from './guard/base';

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

  const otlpHeaders = o.otlpHeaders ?? parseOtlpHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS) ?? {};

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

  let collectGpuStats = o.collectGpuStats ?? undefined;
  const envCollectGpuStats = parseBoolEnv('OPENLIT_COLLECT_GPU_STATS');
  if (collectGpuStats === undefined) {
    collectGpuStats = envCollectGpuStats ?? false;
  }

  const openlitApiKey = o.openlitApiKey ?? process.env.OPENLIT_API_KEY ?? undefined;
  const openlitUrl = o.openlitUrl ?? process.env.OPENLIT_URL ?? undefined;

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
    openlitApiKey,
    openlitUrl,
    guards: o.guards,
    guardFailOpen: o.guardFailOpen ?? true,
    collectGpuStats,
    trustIncomingTraceparent: o.trustIncomingTraceparent ?? false,
  };
}

const PRICING_BUDGET_MS = 2000;

class Openlit extends BaseOpenlit {
  static resource: ReturnType<typeof resourceFromAttributes>;
  static options: ResolvedOptions;
  private static initArguments?: OpenlitOptions;
  /** Edge only: a pricing URL still to fetch from inside a request. */
  private static pendingPricingUrl?: string;

  // Top-level guard class exports
  static PII = PII;
  static PromptInjection = PromptInjection;
  static Moderation = Moderation;
  static SensitiveTopic = SensitiveTopic;
  static TopicRestriction = TopicRestriction;
  static Schema = Schema;
  static Custom = Custom;
  static Pipeline = Pipeline;
  static GuardAction = GuardAction;
  static GuardPhase = GuardPhase;
  static GuardError = GuardError;
  static GuardDeniedError = GuardDeniedError;
  static GuardTimeoutError = GuardTimeoutError;
  static GuardConfigError = GuardConfigError;

  static eval = runEval;
  static evalBatch = runEvalBatch;
  static getEvalTypes = fetchEvalTypes;
  static logScore = logScore;

  /**
   * Public API: stamp every subsequent chat span / inference event in the
   * current async scope with a user-supplied agent version label
   * (`gen_ai.agent.version`). Useful when you want versions to follow a
   * release tag, git SHA, or business-meaningful name instead of the SDK's
   * auto-computed fingerprint.
   *
   * For a one-shot block, prefer `OpenLit.withAgentVersion(label, fn)`.
   */
  static setAgentVersion = setAgentVersion;
  /**
   * Clear the agent version label set by `setAgentVersion`. Always call this
   * in a `finally` block when you use `setAgentVersion` directly, otherwise
   * the label will persist on subsequent requests handled by the same
   * worker. Prefer `withAgentVersion(label, fn)` for scoped usage.
   */
  static resetAgentVersion = resetAgentVersion;
  static withAgentVersion = runWithAgentVersion;
  static getAgentVersion = getCurrentAgentVersion;

  static startTrace = startTrace;
  static trace = traceManual;
  static llm = llm;
  static instrument = instrument;
  static instrumentFetch = instrumentFetch;
  static withTags = withTags;

  static traceContextFrom = traceContextFrom;
  static withParent = withParent;
  static recordSpan = recordSpan;
  static inject = inject;
  static extract = extract;

  static codingAgent = { env: codingAgentEnv };

  /**
   * Send everything buffered. Resolves once the exporters finish, and never
   * rejects, because a telemetry failure must not fail the caller's request. Call
   * it before a short-lived process exits.
   */
  static flush = async (): Promise<void> => {
    await Openlit.ensurePricing();
    await Openlit.settle([Tracing.forceFlush(), Events.forceFlush(), Metrics.forceFlush()]);
  };

  /** Spans lost to the bounded edge buffer so far. Always 0 on Node. */
  static droppedSpans = (): number => Tracing.droppedSpans;

  /** Flush, then stop the exporters. Nothing is sent after this. */
  static shutdown = async (): Promise<void> => {
    await Openlit.settle([Tracing.shutdown(), Events.shutdown(), Metrics.shutdown()]);
  };

  private static async settle(work: Promise<unknown>[]): Promise<void> {
    for (const result of await Promise.allSettled(work)) {
      if (result.status === 'rejected') diag.warn(`OpenLIT: flush failed: ${result.reason}`);
    }
  }

  private static lifecycle = {
    flush: () => Openlit.flush(),
    applyRuntimeOptions: (bindings: OpenlitOptions, configured?: OpenlitOptions) =>
      Openlit.applyRuntimeOptions(bindings, configured),
    ensurePricing: () => Openlit.ensurePricing(),
  };

  static withWorker = createWorkerWrapper(Openlit.lifecycle);
  static withLambda = createLambdaWrapper(Openlit.lifecycle);

  /** Merge settings that only exist once a request arrives, such as Worker bindings. */
  private static applyRuntimeOptions(bindings: OpenlitOptions, configured?: OpenlitOptions) {
    const merged = { ...bindings, ...this.initArguments, ...configured };
    if (!this.options) {
      this.init(merged);
      return;
    }
    const resolved = resolveOptions(merged);
    this.options = resolved;
    this.resource = this.buildResource(resolved);
    Tracing.reconfigure({ ...resolved, resource: this.resource });
    OpenlitConfig.openlitApiKey = resolved.openlitApiKey;
    OpenlitConfig.openlitUrl = resolved.openlitUrl;
    OpenlitConfig.tokenCounter = merged.tokenCounter;
    OpenlitConfig.trustIncomingTraceparent = resolved.trustIncomingTraceparent;
    this.loadPricing(resolved.pricingJson);

    // `init()` already ran at module scope, so settings that only `init()` acts
    // on are applied here when the Worker's own settings bring them.
    const initial = this.initArguments ?? {};
    const guardsChanged = merged.guards !== initial.guards || merged.guardFailOpen !== initial.guardFailOpen;
    if (resolved.guards?.length && guardsChanged) {
      setupAutoGuards(resolved.guards, resolved.guardFailOpen, resolved.instrumentations);
    }
    if (merged.fetchAdapters?.length && !initial.fetchAdapters?.length) {
      instrumentFetch(merged.fetchAdapters);
    }
  }

  private static buildResource(resolved: ResolvedOptions) {
    return resourceFromAttributes({
      [ATTR_SERVICE_NAME]: resolved.applicationName,
      [SemanticConvention.ATTR_DEPLOYMENT_ENVIRONMENT]: resolved.environment,
      [ATTR_TELEMETRY_SDK_NAME]: SDK_NAME,
    });
  }

  /**
   * Node fetches pricing in the background from `init()`. Module scope on the
   * edge allows no I/O, so the edge starts from a bundled snapshot, and a custom
   * URL is fetched by `ensurePricing()` once a request is running.
   */
  private static loadPricing(pricingJson: ResolvedOptions['pricingJson']) {
    if (IS_EDGE_BUILD && (!pricingJson || OpenLitHelper.isPricingUrl(pricingJson))) {
      OpenlitConfig.pricingInfo = pricingSnapshot() ?? {};
      this.pendingPricingUrl = pricingJson as string | undefined;
      return;
    }
    OpenLitHelper.fetchPricingInfo(pricingJson).then(
      (info) => { OpenlitConfig.pricingInfo = info; },
      () => { OpenlitConfig.pricingInfo = {}; }
    );
  }

  /** Replaces the snapshot if it can, within a budget. Never fails the caller. */
  private static async ensurePricing(): Promise<void> {
    const url = this.pendingPricingUrl;
    if (!url) return;
    this.pendingPricingUrl = undefined;
    try {
      const info = await withinBudget(OpenLitHelper.fetchPricingInfo(url), PRICING_BUDGET_MS);
      if (info && Object.keys(info).length > 0) OpenlitConfig.pricingInfo = info;
    } catch (error) {
      diag.warn(`OpenLIT: keeping bundled pricing, could not load ${url}: ${error}`);
    }
  }

  static init(options?: OpenlitOptions) {
    try {
      diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);

      this.initArguments = options;
      OpenlitConfig.tokenCounter = options?.tokenCounter;
      OpenlitConfig.trustIncomingTraceparent = options?.trustIncomingTraceparent ?? false;
      const resolved = resolveOptions(options);
      this.options = resolved;

      this.resource = this.buildResource(resolved);

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

        const meter = Metrics.setup({
          ...setupBase,
          exportIntervalMillis,
        });

        // GPU metrics: only register gauges when a supported GPU is detected
        // (mirrors Python openlit.init collect_gpu_stats path).
        if (resolved.collectGpuStats && meter) {
          new GpuMetricsCollector()
            .setup({
              meter,
              environment: resolved.environment,
              applicationName: resolved.applicationName,
            })
            .catch((e) => {
              diag.error(`OpenLIT GPU metrics setup failed: ${e}`);
            });
        }
      }

      OpenlitConfig.openlitApiKey = resolved.openlitApiKey;
      OpenlitConfig.openlitUrl = resolved.openlitUrl;

      this.loadPricing(resolved.pricingJson);

      if (options?.fetchAdapters?.length) {
        instrumentFetch(options.fetchAdapters);
      }

      if (resolved.guards && resolved.guards.length > 0) {
        setupAutoGuards(resolved.guards, resolved.guardFailOpen, resolved.instrumentations);
      }
    } catch (e) {
      console.error('OpenLIT initialization failed:', e);
    }
  }
}

const openlit = Openlit as typeof Openlit & {
  usingAttributes: typeof usingAttributes;
  injectAdditionalAttributes: typeof injectAdditionalAttributes;
};

(openlit as any).usingAttributes = usingAttributes;
// ESM callers used to reach the class as `openlit.default`; that still works now
// that `dist/index.mjs` gives them the class directly.
(openlit as any).default = openlit;
(openlit as any).injectAdditionalAttributes = injectAdditionalAttributes;

export default openlit;
export { Openlit, usingAttributes, injectAdditionalAttributes, withTags, logScore };
export { TracedSpan, startTrace, traceManual as trace, LlmSpan, llm };
export { instrument, instrumentFetch, traceContextFrom, withParent, recordSpan, inject, extract };
export type { LlmCallOptions, LlmResponse, LlmUsage } from './llm-call';
export type { RecordSpanOptions, RunTraceContext } from './trace-context';
export type { CodingAgentEnvOptions } from './coding-agent';
export type { CallTags } from './helpers';
export type { TokenCounter } from './platform/types';
export type { OpenlitOptions } from './types';
export type { LogScoreOptions } from './score';

// Guard re-exports for named imports: import { PII, Pipeline } from 'openlit'
export {
  PII,
  PromptInjection,
  Moderation,
  SensitiveTopic,
  TopicRestriction,
  Schema,
  Custom,
  Pipeline,
  Guard,
  GuardAction,
  GuardPhase,
  GuardError,
  GuardDeniedError,
  GuardTimeoutError,
  GuardConfigError,
  PipelineResult,
};
export type { GuardResult } from './guard/base';
