import { InstrumentationBase, InstrumentationModuleDefinition } from '@opentelemetry/instrumentation';
import { InstrumentationConfig } from '@opentelemetry/instrumentation';
export interface LangChainInstrumentationConfig extends InstrumentationConfig {
}
export default class OpenlitLangChainInstrumentation extends InstrumentationBase {
    private _callbackManager;
    private _ritmHook;
    constructor(config?: LangChainInstrumentationConfig);
    protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[];
    enable(): void;
    disable(): void;
    manualPatch(callbacksManagerModule: any): void;
    private _patchFromCache;
    private _applyPatch;
    private _unpatch;
}
