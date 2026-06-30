import { InstrumentationBase, InstrumentationModuleDefinition } from '@opentelemetry/instrumentation';
import { InstrumentationConfig } from '@opentelemetry/instrumentation';
export interface HuggingFaceInstrumentationConfig extends InstrumentationConfig {
}
export default class OpenlitHuggingFaceInstrumentation extends InstrumentationBase {
    constructor(config?: HuggingFaceInstrumentationConfig);
    protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[];
    manualPatch(hf: any): void;
    private _origTaskFns;
    private _findLeafModule;
    protected _patch(moduleExports: any): void;
    protected _unpatch(moduleExports: any): void;
}
