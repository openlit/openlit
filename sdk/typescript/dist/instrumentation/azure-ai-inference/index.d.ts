import { InstrumentationBase, InstrumentationModuleDefinition } from '@opentelemetry/instrumentation';
import { InstrumentationConfig } from '@opentelemetry/instrumentation';
export interface AzureAIInferenceInstrumentationConfig extends InstrumentationConfig {
}
export default class OpenlitAzureAIInferenceInstrumentation extends InstrumentationBase {
    constructor(config?: AzureAIInferenceInstrumentationConfig);
    protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[];
    manualPatch(azureAIInference: any): void;
    protected _patch(moduleExports: any): void;
    protected _unpatch(moduleExports: any): void;
}
