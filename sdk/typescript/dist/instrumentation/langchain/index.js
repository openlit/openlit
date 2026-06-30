"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const instrumentation_1 = require("@opentelemetry/instrumentation");
const constant_1 = require("../../constant");
const wrapper_1 = __importDefault(require("./wrapper"));
class OpenlitLangChainInstrumentation extends instrumentation_1.InstrumentationBase {
    constructor(config = {}) {
        super(`${constant_1.INSTRUMENTATION_PREFIX}/instrumentation-langchain`, '1.0.0', config);
        this._callbackManager = null;
        this._ritmHook = null;
    }
    init() {
        return [];
    }
    enable() {
        super.enable();
        if (this._ritmHook)
            return;
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { Hook } = require('require-in-the-middle');
            this._ritmHook = new Hook(['@langchain/core/language_models/chat_models'], { internals: true }, (exports) => {
                this._patchFromCache();
                return exports;
            });
        }
        catch { /* require-in-the-middle not available */ }
    }
    disable() {
        super.disable();
        this._ritmHook?.unhook?.();
        this._ritmHook = null;
        this._unpatch();
    }
    manualPatch(callbacksManagerModule) {
        const CallbackManager = callbacksManagerModule?.CallbackManager;
        if (CallbackManager) {
            this._callbackManager = CallbackManager;
            this._applyPatch(CallbackManager);
        }
    }
    _patchFromCache() {
        try {
            const cache = require.cache;
            for (const filepath of Object.keys(cache)) {
                if (filepath.includes('@langchain') &&
                    filepath.includes('callbacks') &&
                    filepath.includes('manager') &&
                    !filepath.endsWith('.map')) {
                    const mod = cache[filepath];
                    const CallbackManager = mod?.exports?.CallbackManager;
                    if (CallbackManager && typeof CallbackManager._configureSync === 'function') {
                        this._callbackManager = CallbackManager;
                        this._applyPatch(CallbackManager);
                        return;
                    }
                }
            }
        }
        catch (e) {
            console.error('LangChain: error scanning require.cache for CallbackManager:', e);
        }
    }
    _applyPatch(CallbackManager) {
        try {
            if ((0, instrumentation_1.isWrapped)(CallbackManager._configureSync)) {
                this._unwrap(CallbackManager, '_configureSync');
            }
            this._wrap(CallbackManager, '_configureSync', wrapper_1.default._patchConfigure(this.tracer));
        }
        catch (e) {
            console.error('Error in LangChain _patch method:', e);
        }
    }
    _unpatch() {
        if (!this._callbackManager)
            return;
        try {
            if ((0, instrumentation_1.isWrapped)(this._callbackManager._configureSync)) {
                this._unwrap(this._callbackManager, '_configureSync');
            }
        }
        catch { /* ignore */ }
        this._callbackManager = null;
    }
}
exports.default = OpenlitLangChainInstrumentation;
//# sourceMappingURL=index.js.map