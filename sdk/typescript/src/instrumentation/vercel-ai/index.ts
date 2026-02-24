import {
  InstrumentationBase,
  InstrumentationModuleDefinition,
  InstrumentationNodeModuleDefinition,
} from '@opentelemetry/instrumentation';
import { InstrumentationConfig } from '@opentelemetry/instrumentation';
import { INSTRUMENTATION_PREFIX } from '../../constant';
import VercelAIWrapper from './wrapper';

export interface VercelAIInstrumentationConfig extends InstrumentationConfig {}

// Functions to intercept from the `ai` module
const PATCHED_FNS = ['generateText', 'streamText', 'generateObject', 'embed'] as const;

export default class OpenlitVercelAIInstrumentation extends InstrumentationBase {
  constructor(config: VercelAIInstrumentationConfig = {}) {
    super(`${INSTRUMENTATION_PREFIX}/instrumentation-vercel-ai`, '1.0.0', config);
  }

  protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[] {
    const module = new InstrumentationNodeModuleDefinition(
      'ai',
      ['>=3.0.0 <5'],
      (moduleExports) => this._patch(moduleExports),
      // No-op unpatch: Proxy is discarded when the module is re-required
      () => {}
    );
    return [module];
  }

  public manualPatch(ai: any): any {
    return this._patch(ai);
  }

  protected _patch(moduleExports: any): any {
    try {
      const tracer = this.tracer;

      // The `ai` package exports functions as non-configurable getter properties,
      // so shimmer's Object.defineProperty-based wrapping fails. Instead, return a
      // Proxy that intercepts property access and returns wrapped functions.
      const patchers: Record<string, (t: typeof tracer) => (orig: any) => any> = {
        generateText: VercelAIWrapper._patchGenerateText,
        streamText: VercelAIWrapper._patchStreamText,
        generateObject: VercelAIWrapper._patchGenerateObject,
        embed: VercelAIWrapper._patchEmbed,
      };

      // Pre-build wrapped functions once (avoid re-wrapping on every get)
      const wrapped: Record<string, any> = {};
      for (const name of PATCHED_FNS) {
        const original = moduleExports[name];
        if (typeof original === 'function') {
          wrapped[name] = patchers[name](tracer)(original);
        }
      }

      return new Proxy(moduleExports, {
        get(target, prop: string, receiver) {
          if (prop in wrapped) return wrapped[prop];
          return Reflect.get(target, prop, receiver);
        },
      });
    } catch (e) {
      console.error('Error in VercelAI _patch method:', e);
      return moduleExports;
    }
  }
}
