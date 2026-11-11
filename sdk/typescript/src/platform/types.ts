/**
 * The part of `AsyncLocalStorage` the SDK relies on. Keeping it this small lets
 * runtimes without `async_hooks` provide their own store.
 */
export interface ContextStore<T> {
  run<R>(value: T, fn: () => R): R;
  getStore(): T | undefined;
  enterWith(value: T): void;
}

export type TokenCounter = (text: string, model?: string) => number;
