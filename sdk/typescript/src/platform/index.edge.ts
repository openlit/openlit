/**
 * Edge replacement for `platform/index.ts`. Must not import Node modules or
 * perform I/O at module scope: Workers rejects both at startup.
 */
import { diag } from '@opentelemetry/api';
import type { PricingObject } from '../types';
import type { ContextStore } from './types';

export type { ContextStore, TokenCounter } from './types';
export { sha1Hex } from './sha1';

export const IS_EDGE_BUILD = true;

// Inlined by `scripts/build-edge.mjs` from `assets/pricing.json`.
declare const __OPENLIT_PRICING__: PricingObject | undefined;

type StoreClass = new <T>() => ContextStore<T>;

/**
 * `process.getBuiltinModule` reaches `AsyncLocalStorage` without an import, so
 * a Worker without `nodejs_compat` still bundles and loads.
 */
function findAsyncLocalStorage(): StoreClass | undefined {
  const scope = globalThis as any;
  if (typeof scope.AsyncLocalStorage === 'function') return scope.AsyncLocalStorage;
  try {
    return scope.process?.getBuiltinModule?.('node:async_hooks')?.AsyncLocalStorage;
  } catch {
    return undefined;
  }
}

const AsyncStore = findAsyncLocalStorage();

let warnedEnterWith = false;

function warnEnterWith(): void {
  if (warnedEnterWith) return;
  warnedEnterWith = true;
  diag.warn('OpenLIT: this runtime cannot set context for the rest of a request. Use the scoped form, such as withAgentVersion().');
}

/**
 * Fallback for runtimes with no async context. Values hold for the synchronous
 * part of `run` only, so after an `await` callers must pass parents explicitly.
 * `enterWith` does nothing here: with no per-request scope to hold the value, it
 * would reach every other request in the isolate.
 */
class SyncContextStore<T> implements ContextStore<T> {
  private current: T | undefined;

  run<R>(value: T, fn: () => R): R {
    const previous = this.current;
    this.current = value;
    try {
      return fn();
    } finally {
      this.current = previous;
    }
  }

  getStore(): T | undefined {
    return this.current;
  }

  enterWith(_value: T): void {
    warnEnterWith();
  }
}

/** workerd has `AsyncLocalStorage` but throws from `enterWith`. */
function safeEnterWith<T>(store: ContextStore<T>): ContextStore<T> {
  const enterWith = store.enterWith?.bind(store);
  store.enterWith = (value: T) => {
    try {
      if (enterWith) enterWith(value);
      else warnEnterWith();
    } catch {
      warnEnterWith();
    }
  };
  return store;
}

export function createContextStore<T>(): ContextStore<T> {
  return AsyncStore ? safeEnterWith(new AsyncStore<T>()) : new SyncContextStore<T>();
}

export function hasAsyncContext(): boolean {
  return AsyncStore !== undefined;
}

/**
 * The tiktoken tables run to megabytes and only load synchronously, so the edge
 * build estimates at the usual four characters per token unless the application
 * passes a `tokenCounter` to `init()`.
 */
export function countTokens(text: string, _model: string): number {
  return Math.ceil(text.length / 4);
}

export function pricingSnapshot(): PricingObject | undefined {
  return typeof __OPENLIT_PRICING__ === 'undefined' ? undefined : __OPENLIT_PRICING__;
}
