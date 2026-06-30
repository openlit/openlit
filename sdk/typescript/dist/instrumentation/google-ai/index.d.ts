import { InstrumentationBase, InstrumentationModuleDefinition } from '@opentelemetry/instrumentation';
import { InstrumentationConfig } from '@opentelemetry/instrumentation';
export interface GoogleAIInstrumentationConfig extends InstrumentationConfig {
}
export default class OpenlitGoogleAIInstrumentation extends InstrumentationBase {
    constructor(config?: GoogleAIInstrumentationConfig);
    protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[];
    manualPatch(googleAI: any): void;
    protected _patch(moduleExports: any): void;
    protected _unpatch(moduleExports: any): void;
}
