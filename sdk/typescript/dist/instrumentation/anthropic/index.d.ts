import { InstrumentationBase, InstrumentationModuleDefinition } from '@opentelemetry/instrumentation';
import { InstrumentationConfig } from '@opentelemetry/instrumentation';
export interface AnthropicInstrumentationConfig extends InstrumentationConfig {
}
export default class OpenlitAnthropicInstrumentation extends InstrumentationBase {
    constructor(config?: AnthropicInstrumentationConfig);
    protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[];
    manualPatch(anthropic: any): void;
    protected _patch(moduleExports: any): void;
    protected _unpatch(moduleExports: any): void;
}
