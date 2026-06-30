import { InstrumentationBase, InstrumentationModuleDefinition } from '@opentelemetry/instrumentation';
import { InstrumentationConfig } from '@opentelemetry/instrumentation';
export interface VercelAIInstrumentationConfig extends InstrumentationConfig {
}
export default class OpenlitVercelAIInstrumentation extends InstrumentationBase {
    constructor(config?: VercelAIInstrumentationConfig);
    protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[];
    manualPatch(ai: any): any;
    protected _patch(moduleExports: any): any;
}
