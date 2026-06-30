import { InstrumentationBase, InstrumentationModuleDefinition } from '@opentelemetry/instrumentation';
import { InstrumentationConfig } from '@opentelemetry/instrumentation';
export interface LangGraphInstrumentationConfig extends InstrumentationConfig {
}
export default class OpenlitLangGraphInstrumentation extends InstrumentationBase {
    constructor(config?: LangGraphInstrumentationConfig);
    protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[];
    manualPatch(langgraph: any): void;
    protected _patch(moduleExports: any): void;
    private _patchPregelProto;
    protected _unpatch(moduleExports: any): void;
}
