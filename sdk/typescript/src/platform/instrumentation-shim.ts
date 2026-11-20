/**
 * Stands in for `@opentelemetry/instrumentation` in the edge build. The real
 * package pulls in module-load hooks, which cannot work in a bundle anyway. The
 * instrumentations only need `_wrap`/`_unwrap` and a tracer, so with this shim
 * their `manualPatch` paths run unchanged.
 */
import { Tracer, TracerProvider, trace } from '@opentelemetry/api';

const WRAPPED = Symbol.for('openlit.wrapped');

export type InstrumentationConfig = Record<string, unknown>;
export type InstrumentationModuleDefinition = unknown;

export function isWrapped(fn: unknown): boolean {
  return typeof fn === 'function' && (fn as any)[WRAPPED] !== undefined;
}

export class InstrumentationNodeModuleDefinition {
  constructor(..._args: unknown[]) {}
}

export class InstrumentationNodeModuleFile {
  constructor(..._args: unknown[]) {}
}

export abstract class InstrumentationBase {
  private provider?: TracerProvider;

  constructor(
    readonly instrumentationName: string,
    readonly instrumentationVersion: string,
    _config?: unknown
  ) {}

  protected init(): unknown {
    return undefined;
  }

  protected get tracer(): Tracer {
    return (this.provider ?? trace.getTracerProvider()).getTracer(
      this.instrumentationName,
      this.instrumentationVersion
    );
  }

  setTracerProvider(provider: TracerProvider): void {
    this.provider = provider;
  }

  enable(): void {}

  disable(): void {}

  protected _wrap(target: any, name: string, wrapper: (original: any) => any): any {
    const original = target?.[name];
    if (typeof original !== 'function') return undefined;
    const wrapped = wrapper(original);
    wrapped[WRAPPED] = original;
    target[name] = wrapped;
    return wrapped;
  }

  protected _unwrap(target: any, name: string): void {
    const current = target?.[name];
    if (isWrapped(current)) target[name] = current[WRAPPED];
  }
}

/** `require-in-the-middle`: the callers guard this in a try block. */
export class Hook {
  constructor() {
    throw new Error('module hooks are not available in this build');
  }
}

export function registerInstrumentations(_options: unknown): () => void {
  return () => undefined;
}
