import { InstrumentationBase, InstrumentationModuleDefinition } from '@opentelemetry/instrumentation';
import { InstrumentationConfig } from '@opentelemetry/instrumentation';
export interface ChromaInstrumentationConfig extends InstrumentationConfig {
}
export default class OpenlitChromaInstrumentation extends InstrumentationBase {
    constructor(config?: ChromaInstrumentationConfig);
    protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[];
    manualPatch(chroma: any): void;
    protected _patch(moduleExports: any): void;
    protected _unpatch(moduleExports: any): void;
}
