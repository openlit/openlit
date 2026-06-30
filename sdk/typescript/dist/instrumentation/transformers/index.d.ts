import { InstrumentationBase, InstrumentationModuleDefinition } from '@opentelemetry/instrumentation';
import { InstrumentationConfig } from '@opentelemetry/instrumentation';
export interface TransformersInstrumentationConfig extends InstrumentationConfig {
}
/**
 * Instruments local HuggingFace inference via the Transformers.js SDK.
 *
 * Supported packages (registered as separate module definitions so either
 * package name triggers instrumentation):
 *   - `@huggingface/transformers` (current name, v3+)
 *   - `@xenova/transformers` (older name)
 *
 * Parity: the Python SDK instruments `transformers.TextGenerationPipeline.__call__`
 * and reports it as the `chat` operation. Transformers.js implements each
 * pipeline as a subclass whose `_call` method runs the inference, so we patch
 * the `_call` of every known pipeline subclass (and the base `Pipeline` as a
 * final catch). The operation type is resolved at runtime from the pipeline's
 * `task`, so text-generation matches Python while other local pipelines
 * (summarization, translation, feature-extraction, …) get the closest OTel
 * operation.
 */
export default class OpenlitTransformersInstrumentation extends InstrumentationBase {
    constructor(config?: TransformersInstrumentationConfig);
    protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[];
    manualPatch(transformers: any): void;
    /**
     * Pipeline subclasses whose `_call` we patch. Most specific first; the base
     * `Pipeline` is the final fallback. Subclasses that inherit `_call` from an
     * ancestor in this list are covered by that ancestor's patch (the operation
     * is resolved from the live instance's `task`, so the span stays correct).
     */
    private static readonly PIPELINE_CLASSES;
    protected _patch(moduleExports: any, moduleVersion?: string): void;
    protected _unpatch(moduleExports: any): void;
}
