import { InstrumentationBase, InstrumentationModuleDefinition } from '@opentelemetry/instrumentation';
import { InstrumentationConfig } from '@opentelemetry/instrumentation';
export interface Mem0InstrumentationConfig extends InstrumentationConfig {
}
export default class OpenlitMem0Instrumentation extends InstrumentationBase {
    constructor(config?: Mem0InstrumentationConfig);
    protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[];
    manualPatch(mem0: any): void;
    /** Patch the hosted MemoryClient (default export of `mem0ai`). */
    protected _patch(moduleExports: any, moduleVersion?: string): void;
    /** Patch the self-hosted Memory class (`mem0ai/oss`). */
    protected _patchOss(moduleExports: any, moduleVersion?: string): void;
    private _patchClass;
    protected _unpatch(moduleExports: any): void;
    protected _unpatchOss(moduleExports: any): void;
    private _unpatchClass;
}
