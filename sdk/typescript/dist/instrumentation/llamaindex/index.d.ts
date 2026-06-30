/**
 * OpenLIT LlamaIndex Instrumentation
 *
 * Monkey-patches LlamaIndex JS classes to emit OTel-compliant telemetry.
 * Mirrors the Python SDK: sdk/python/src/openlit/instrumentation/llamaindex/__init__.py
 *
 * Targets the `llamaindex` npm package (>=0.3.0).
 * Patches: LLM classes, query engines, chat engines, retrievers, embeddings,
 * index construction, document loaders, splitters, and synthesizers.
 */
import { InstrumentationBase, InstrumentationModuleDefinition } from '@opentelemetry/instrumentation';
import type { InstrumentationConfig } from '@opentelemetry/instrumentation';
export default class OpenlitLlamaIndexInstrumentation extends InstrumentationBase {
    constructor(config?: InstrumentationConfig);
    protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[];
    manualPatch(llamaindex: any): void;
    /**
     * Wrap an instance method on the first class found that exposes it.
     * Silently skips classes that aren't exported or don't have the method.
     */
    private _patchProto;
    /**
     * Wrap a static method on a class.
     */
    private _patchStatic;
    /**
     * Unwrap an instance method if it's wrapped.
     */
    private _unwrapProto;
    /**
     * Unwrap a static method if it's wrapped.
     */
    private _unwrapStatic;
    protected _patch(m: any): void;
    protected _unpatch(m: any): void;
}
