import { Context, Link, SpanKind, SpanStatusCode, ROOT_CONTEXT, context, diag, trace as otelTrace } from '@opentelemetry/api';
import OpenlitConfig from './config';
import OpenLitHelper from './helpers';
import { getTracer } from './manual-trace';
import { extract } from './trace-context';
import type { OpenlitOptions } from './types';

type Lifecycle = {
  flush(): Promise<void>;
  applyRuntimeOptions(bindings: OpenlitOptions, configured?: OpenlitOptions): void;
  ensurePricing(): Promise<void>;
};

export type WorkerContext = { waitUntil(promise: Promise<unknown>): void };
export type WorkerOptions<Env> = (env: Env) => OpenlitOptions;

/** The handler shapes `withWorker` traces. Any other export passes through. */
export type WorkerHandler<Env> = {
  fetch?: (request: Request, env: Env, ctx: any) => Response | Promise<Response>;
  scheduled?: (controller: any, env: Env, ctx: any) => unknown;
  queue?: (batch: any, env: Env, ctx: any) => unknown;
  [key: string]: any;
};

const LAMBDA_FLUSH_BUDGET_MS = 2000;
const LAMBDA_FLUSH_MARGIN_MS = 500;
const MAX_PATH_LENGTH = 256;

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function bool(value: unknown): boolean | undefined {
  const text = str(value)?.toLowerCase();
  if (text === 'true') return true;
  return text === 'false' ? false : undefined;
}

function headersFromEnv(value: unknown): Record<string, string> | undefined {
  const raw = str(value);
  if (!raw) return undefined;
  const headers: Record<string, string> = {};
  for (const item of raw.split(',')) {
    const separator = item.indexOf('=');
    if (separator <= 0) continue;
    const rawValue = item.slice(separator + 1).trim();
    try {
      headers[item.slice(0, separator).trim()] = decodeURIComponent(rawValue);
    } catch {
      headers[item.slice(0, separator).trim()] = rawValue;
    }
  }
  return headers;
}

/** Worker bindings are not on `process.env`; they reach the SDK through here. */
function optionsFromBindings(env: Record<string, unknown>): OpenlitOptions {
  const options: OpenlitOptions = {};
  const endpoint = str(env?.OTEL_EXPORTER_OTLP_ENDPOINT);
  const headers = headersFromEnv(env?.OTEL_EXPORTER_OTLP_HEADERS);
  const applicationName = str(env?.OTEL_SERVICE_NAME);
  const environment = str(env?.OTEL_DEPLOYMENT_ENVIRONMENT);
  const openlitApiKey = str(env?.OPENLIT_API_KEY);
  const openlitUrl = str(env?.OPENLIT_URL);
  const captureMessageContent = bool(env?.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT);
  const trustIncomingTraceparent = bool(env?.OPENLIT_TRUST_INCOMING_TRACEPARENT);
  if (endpoint) options.otlpEndpoint = endpoint;
  if (headers) options.otlpHeaders = headers;
  if (applicationName) options.applicationName = applicationName;
  if (environment) options.environment = environment;
  if (openlitApiKey) options.openlitApiKey = openlitApiKey;
  if (openlitUrl) options.openlitUrl = openlitUrl;
  if (captureMessageContent !== undefined) options.captureMessageContent = captureMessageContent;
  if (trustIncomingTraceparent !== undefined) options.trustIncomingTraceparent = trustIncomingTraceparent;
  return options;
}

/**
 * A response can outlive the handler while its body streams, and model spans end
 * with it. Keep the isolate alive through `waitUntil` until the body ends, fails or
 * is cancelled, then flush. A `content-length` means the body is already complete.
 */
function flushAfterBody(response: Response, flush: () => Promise<void>, ctx: WorkerContext): Response {
  if (!response.body || response.headers?.get?.('content-length')) return response;

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    ctx.waitUntil(flush());
  };
  const reader = response.body.getReader();
  const body = new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          finish();
        } else {
          controller.enqueue(value);
        }
      } catch (error) {
        controller.error(error);
        finish();
      }
    },
    cancel(reason) {
      finish();
      return reader.cancel(reason);
    },
  });
  return new Response(body, response);
}

/** The handler's `ctx`, with spans from `waitUntil` work flushed once it settles. */
function trackBackgroundWork<C extends WorkerContext>(ctx: C, flush: () => Promise<void>): C {
  return new Proxy(ctx, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (property === 'waitUntil') {
        return (promise: Promise<unknown>) => {
          target.waitUntil(promise);
          target.waitUntil(Promise.resolve(promise).then(flush, flush));
        };
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function requestParent(request: Request): { parent: Context; links: Link[] } {
  const incoming = extract(request.headers);
  if (OpenlitConfig.trustIncomingTraceparent) return { parent: incoming, links: [] };
  const remote = otelTrace.getSpanContext(incoming);
  return { parent: ROOT_CONTEXT, links: remote ? [{ context: remote }] : [] };
}

export function createWorkerWrapper(lifecycle: Lifecycle) {
  type Prepare = (env: any, ctx: WorkerContext) => void;

  const traceFetch = async (
    request: Request,
    env: unknown,
    ctx: WorkerContext,
    prepare: Prepare,
    call: (ctx: any) => Response | Promise<Response>
  ) => {
    prepare(env, ctx);
    const { pathname } = new URL(request.url);
    const path = pathname.slice(0, MAX_PATH_LENGTH);
    const { parent, links } = requestParent(request);
    const span = getTracer().startSpan(
      `${request.method} ${path}`,
      {
        kind: SpanKind.SERVER,
        links,
        attributes: { 'http.request.method': request.method, 'url.path': path },
      },
      parent
    );
    try {
      const response = await context.with(otelTrace.setSpan(parent, span), () =>
        call(trackBackgroundWork(ctx, lifecycle.flush))
      );
      span.setAttribute('http.response.status_code', response.status);
      if (response.status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
      ctx.waitUntil(lifecycle.flush());
      return flushAfterBody(response, lifecycle.flush, ctx);
    } catch (error: any) {
      OpenLitHelper.handleException(span, error);
      span.end();
      ctx.waitUntil(lifecycle.flush());
      throw error;
    }
  };

  const traceEvent = async (
    event: string,
    env: unknown,
    ctx: WorkerContext,
    prepare: Prepare,
    call: (ctx: any) => unknown
  ) => {
    prepare(env, ctx);
    try {
      return await getTracer().startActiveSpan(`worker.${event}`, { kind: SpanKind.CONSUMER }, async (span: any) => {
        try {
          return await call(trackBackgroundWork(ctx, lifecycle.flush));
        } catch (error: any) {
          OpenLitHelper.handleException(span, error);
          throw error;
        } finally {
          span.end();
        }
      });
    } finally {
      ctx.waitUntil(lifecycle.flush());
    }
  };

  /**
   * Wrap a module Worker: a handler object, or a class such as `WorkerEntrypoint`
   * or `DurableObject`. Traces each `fetch`, `scheduled` and `queue`, and sends the
   * spans in `ctx.waitUntil`. Settings come from bindings
   * (`OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`,
   * `OTEL_SERVICE_NAME`, `OPENLIT_API_KEY`), and `configure` overrides them.
   */
  function withWorker<Env = any, Handler extends WorkerHandler<Env> = WorkerHandler<Env>>(
    handler: Handler,
    configure?: WorkerOptions<Env>
  ): Handler;
  function withWorker<Env = any, Handler extends new (...args: any[]) => any = any>(
    handler: Handler,
    configure?: WorkerOptions<Env>
  ): Handler;
  function withWorker(handler: any, configure?: WorkerOptions<any>): any {
    let configured = false;

    // Pricing never holds a request: it applies from the next span once loaded.
    const prepare: Prepare = (env, ctx) => {
      if (!configured) {
        configured = true;
        try {
          lifecycle.applyRuntimeOptions(optionsFromBindings(env), configure?.(env));
        } catch (error) {
          diag.warn(`OpenLIT: could not apply Worker settings: ${error}`);
        }
      }
      ctx.waitUntil(lifecycle.ensurePricing());
    };

    if (typeof handler === 'function') {
      const Traced = class extends handler {} as any;
      const inherited = handler.prototype;
      if (typeof inherited.fetch === 'function') {
        Traced.prototype.fetch = function (this: any, request: Request) {
          return traceFetch(request, this.env, this.ctx, prepare, () => inherited.fetch.call(this, request));
        };
      }
      for (const event of ['scheduled', 'queue']) {
        if (typeof inherited[event] !== 'function') continue;
        Traced.prototype[event] = function (this: any, payload: unknown) {
          return traceEvent(event, this.env, this.ctx, prepare, () => inherited[event].call(this, payload));
        };
      }
      return Traced;
    }

    // A handler object may be a class instance, so its prototype stays in place.
    const wrapped = Object.assign(Object.create(Object.getPrototypeOf(handler)), handler);

    if (typeof handler.fetch === 'function') {
      wrapped.fetch = function (this: unknown, request: Request, env: unknown, ctx: WorkerContext) {
        return traceFetch(request, env, ctx, prepare, (tracked) => handler.fetch.call(this, request, env, tracked));
      };
    }
    for (const event of ['scheduled', 'queue']) {
      if (typeof handler[event] !== 'function') continue;
      wrapped[event] = function (this: unknown, payload: unknown, env: unknown, ctx: WorkerContext) {
        return traceEvent(event, env, ctx, prepare, (tracked) => handler[event].call(this, payload, env, tracked));
      };
    }
    return wrapped;
  }

  return withWorker;
}

/** Resolves with `work`, or undefined once `millis` pass, leaving it to finish alone. */
export function withinBudget<T>(work: Promise<T>, millis: number): Promise<T | undefined> {
  let timer: any;
  const expiry = new Promise<undefined>((resolve) => {
    timer = setTimeout(resolve, millis);
  });
  return Promise.race([work, expiry]).finally(() => clearTimeout(timer));
}

export function createLambdaWrapper(lifecycle: Lifecycle) {
  /**
   * Wrap an async Lambda handler. Lambda freezes the process as soon as the
   * handler returns, so the flush happens first, within a budget: a collector that
   * is down must not turn a healthy invocation into a timeout.
   */
  return function withLambda<Event, Result>(
    handler: (event: Event, lambdaContext: any) => Promise<Result>
  ): (event: Event, lambdaContext: any) => Promise<Result> {
    return async (event, lambdaContext) => {
      await lifecycle.ensurePricing();
      try {
        return await getTracer().startActiveSpan(
          lambdaContext?.functionName ?? 'lambda.invoke',
          {
            kind: SpanKind.SERVER,
            attributes: lambdaContext?.awsRequestId ? { 'faas.invocation_id': lambdaContext.awsRequestId } : {},
          },
          async (span: any) => {
            try {
              return await handler(event, lambdaContext);
            } catch (error: any) {
              OpenLitHelper.handleException(span, error);
              throw error;
            } finally {
              span.end();
            }
          }
        );
      } finally {
        const remaining = lambdaContext?.getRemainingTimeInMillis?.();
        const budget =
          typeof remaining === 'number'
            ? Math.max(Math.min(LAMBDA_FLUSH_BUDGET_MS, remaining - LAMBDA_FLUSH_MARGIN_MS), 0)
            : LAMBDA_FLUSH_BUDGET_MS;
        await withinBudget(lifecycle.flush(), budget);
      }
    };
  };
}
