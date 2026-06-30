import { InstrumentationBase, InstrumentationModuleDefinition } from '@opentelemetry/instrumentation';
import { InstrumentationConfig } from '@opentelemetry/instrumentation';
export interface GradientInstrumentationConfig extends InstrumentationConfig {
}
export default class OpenlitGradientInstrumentation extends InstrumentationBase {
    constructor(config?: GradientInstrumentationConfig);
    private safeWrap;
    protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[];
    manualPatch(gradient: any): void;
    protected _patch(moduleExports: any): void;
    protected _unpatch(moduleExports: any): void;
}
