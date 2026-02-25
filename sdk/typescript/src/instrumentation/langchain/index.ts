import {
  InstrumentationBase,
  InstrumentationModuleDefinition,
  isWrapped,
} from '@opentelemetry/instrumentation';
import { InstrumentationConfig } from '@opentelemetry/instrumentation';
import { INSTRUMENTATION_PREFIX } from '../../constant';
import LangChainWrapper from './wrapper';

export interface LangChainInstrumentationConfig extends InstrumentationConfig {}

export default class OpenlitLangChainInstrumentation extends InstrumentationBase {
  private _callbackManager: any = null;
  private _ritmHook: any = null;

  constructor(config: LangChainInstrumentationConfig = {}) {
    super(`${INSTRUMENTATION_PREFIX}/instrumentation-langchain`, '1.0.0', config);
  }

  protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[] {
    // We bypass OTel's RequireInTheMiddleSingleton here because it uses a null-whitelist
    // RITM instance, which causes RITM to report `name` as the `fullModuleName` (including
    // the .cjs extension), e.g. '@langchain/core/language_models/chat_models.cjs'.
    // The trie search then fails to match our registered bare name (without .cjs).
    // Instead, we set up a direct require-in-the-middle Hook in enable() with a proper
    // whitelist, which causes RITM to preserve the original specifier as `name`.
    return [];
  }

  /** Override enable() to install a direct RITM Hook rather than going through the singleton. */
  public enable(): void {
    super.enable(); // sets this._enabled = true, initialises tracer
    if (this._ritmHook) return;
    try {
      // Require RITM directly — it is a transitive dep of @opentelemetry/instrumentation.
      // Using a whitelist ['@langchain/core/language_models/chat_models'] causes RITM to
      // preserve the original module specifier as `name` (avoiding the .cjs issue).
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { Hook } = require('require-in-the-middle');
      this._ritmHook = new Hook(
        ['@langchain/core/language_models/chat_models'],
        { internals: true },
        (exports: any) => {
          this._patchFromCache();
          return exports;
        }
      );
    } catch { /* require-in-the-middle not available — no-op */ }
  }

  /** Override disable() to remove our direct RITM Hook. */
  public disable(): void {
    super.disable();
    this._ritmHook?.unhook?.();
    this._ritmHook = null;
    this._unpatch();
  }

  /** Called from tests / manual usage — pass the @langchain/core/callbacks/manager exports. */
  public manualPatch(callbacksManagerModule: any): void {
    const CallbackManager = callbacksManagerModule?.CallbackManager;
    if (CallbackManager) {
      this._callbackManager = CallbackManager;
      this._applyPatch(CallbackManager);
    }
  }

  /**
   * Scan require.cache for @langchain/core's dist/callbacks/manager.cjs.
   * It is always loaded as a relative dep before the chat_models hook fires.
   */
  private _patchFromCache(): void {
    try {
      const cache = (require as NodeJS.Require & { cache: Record<string, any> }).cache;
      for (const filepath of Object.keys(cache)) {
        if (
          filepath.includes('@langchain') &&
          filepath.includes('callbacks') &&
          filepath.includes('manager') &&
          !filepath.endsWith('.map')
        ) {
          const mod = cache[filepath];
          const CallbackManager = mod?.exports?.CallbackManager;
          if (CallbackManager && typeof CallbackManager._configureSync === 'function') {
            this._callbackManager = CallbackManager;
            this._applyPatch(CallbackManager);
            return;
          }
        }
      }
    } catch (e) {
      console.error('LangChain: error scanning require.cache for CallbackManager:', e);
    }
  }

  private _applyPatch(CallbackManager: any): void {
    try {
      // Patch _configureSync — the single low-level entry point called by both
      // CallbackManager.configure and getCallbackManagerForConfig (Runnables/chains).
      if (isWrapped(CallbackManager._configureSync)) {
        this._unwrap(CallbackManager, '_configureSync');
      }
      this._wrap(
        CallbackManager,
        '_configureSync',
        LangChainWrapper._patchConfigure(this.tracer)
      );
    } catch (e) {
      console.error('Error in LangChain _patch method:', e);
    }
  }

  private _unpatch(): void {
    if (!this._callbackManager) return;
    try {
      if (isWrapped(this._callbackManager._configureSync)) {
        this._unwrap(this._callbackManager, '_configureSync');
      }
    } catch { /* ignore */ }
    this._callbackManager = null;
  }
}
