import { InstrumentationBase, InstrumentationModuleDefinition } from '@opentelemetry/instrumentation';
import { InstrumentationConfig } from '@opentelemetry/instrumentation';
export interface MilvusInstrumentationConfig extends InstrumentationConfig {
}
export default class OpenlitMilvusInstrumentation extends InstrumentationBase {
    constructor(config?: MilvusInstrumentationConfig);
    protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[];
    manualPatch(milvus: any): void;
    protected _patch(moduleExports: any): void;
    protected _unpatch(moduleExports: any): void;
}
