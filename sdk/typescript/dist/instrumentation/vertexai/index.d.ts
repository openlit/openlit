import { InstrumentationBase, InstrumentationModuleDefinition } from '@opentelemetry/instrumentation';
import { InstrumentationConfig } from '@opentelemetry/instrumentation';
export interface VertexAIInstrumentationConfig extends InstrumentationConfig {
}
export default class OpenlitVertexAIInstrumentation extends InstrumentationBase {
    constructor(config?: VertexAIInstrumentationConfig);
    protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[];
    manualPatch(vertexAI: any): void;
    protected _patch(moduleExports: any): void;
    protected _unpatch(moduleExports: any): void;
}
