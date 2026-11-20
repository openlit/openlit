import { Context, ContextManager, ROOT_CONTEXT } from '@opentelemetry/api';
import { createContextStore } from '../platform';

/**
 * OpenTelemetry context on top of the platform store, for runtimes where
 * `@opentelemetry/context-async-hooks` cannot load.
 */
export class PlatformContextManager implements ContextManager {
  private store = createContextStore<Context>();

  active(): Context {
    return this.store.getStore() ?? ROOT_CONTEXT;
  }

  with<A extends unknown[], F extends (...args: A) => ReturnType<F>>(
    context: Context,
    fn: F,
    thisArg?: ThisParameterType<F>,
    ...args: A
  ): ReturnType<F> {
    return this.store.run(context, () => fn.call(thisArg, ...args));
  }

  bind<T>(context: Context, target: T): T {
    if (typeof target !== 'function') return target;
    const run = (self: unknown, args: unknown[]) =>
      this.with(context, () => (target as (...a: unknown[]) => unknown).apply(self, args));
    return function (this: unknown, ...args: unknown[]) {
      return run(this, args);
    } as unknown as T;
  }

  enable(): this {
    return this;
  }

  disable(): this {
    return this;
  }
}
