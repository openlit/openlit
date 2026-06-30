"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const instrumentation_1 = require("@opentelemetry/instrumentation");
const api_1 = require("@opentelemetry/api");
const constant_1 = require("../../constant");
const wrapper_1 = __importDefault(require("./wrapper"));
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
class OpenlitTransformersInstrumentation extends instrumentation_1.InstrumentationBase {
    constructor(config = {}) {
        super(`${constant_1.INSTRUMENTATION_PREFIX}/instrumentation-transformers`, '1.0.0', config);
    }
    init() {
        const makeDef = (packageName) => new instrumentation_1.InstrumentationNodeModuleDefinition(packageName, ['>=2.0.0'], (moduleExports, moduleVersion) => {
            this._patch(moduleExports, moduleVersion);
            return moduleExports;
        }, (moduleExports) => {
            if (moduleExports !== undefined) {
                this._unpatch(moduleExports);
            }
        });
        return [makeDef('@huggingface/transformers'), makeDef('@xenova/transformers')];
    }
    manualPatch(transformers) {
        this._patch(transformers);
    }
    _patch(moduleExports, moduleVersion) {
        try {
            const tracer = this.tracer;
            const sdkVersion = moduleVersion ? String(moduleVersion) : undefined;
            let patched = false;
            for (const className of OpenlitTransformersInstrumentation.PIPELINE_CLASSES) {
                const PipelineClass = moduleExports[className];
                const proto = PipelineClass?.prototype;
                if (!proto)
                    continue;
                // Only patch a class that defines its OWN `_call`, so each distinct
                // implementation is wrapped exactly once. Subclasses that inherit
                // `_call` reuse the ancestor's wrapped method.
                if (!Object.prototype.hasOwnProperty.call(proto, '_call'))
                    continue;
                if (typeof proto._call !== 'function')
                    continue;
                if ((0, instrumentation_1.isWrapped)(proto._call)) {
                    this._unwrap(proto, '_call');
                }
                this._wrap(proto, '_call', wrapper_1.default._patchPipelineCall(tracer, className, sdkVersion));
                patched = true;
            }
            // Fallback: if no Pipeline subclass exposed `_call` (very old or very new
            // SDK internals), wrap the `pipeline()` factory instead.
            if (!patched && typeof moduleExports.pipeline === 'function') {
                if (!(0, instrumentation_1.isWrapped)(moduleExports.pipeline)) {
                    this._wrap(moduleExports, 'pipeline', wrapper_1.default._patchPipelineFactory(tracer, sdkVersion));
                }
            }
        }
        catch (e) {
            api_1.diag.error('transformers instrumentation: error in _patch method', e);
        }
    }
    _unpatch(moduleExports) {
        try {
            for (const className of OpenlitTransformersInstrumentation.PIPELINE_CLASSES) {
                const proto = moduleExports[className]?.prototype;
                if (!proto)
                    continue;
                if (Object.prototype.hasOwnProperty.call(proto, '_call') && (0, instrumentation_1.isWrapped)(proto._call)) {
                    this._unwrap(proto, '_call');
                }
            }
            if ((0, instrumentation_1.isWrapped)(moduleExports.pipeline)) {
                this._unwrap(moduleExports, 'pipeline');
            }
        }
        catch (e) {
            api_1.diag.error('transformers instrumentation: error in _unpatch method', e);
        }
    }
}
/**
 * Pipeline subclasses whose `_call` we patch. Most specific first; the base
 * `Pipeline` is the final fallback. Subclasses that inherit `_call` from an
 * ancestor in this list are covered by that ancestor's patch (the operation
 * is resolved from the live instance's `task`, so the span stays correct).
 */
OpenlitTransformersInstrumentation.PIPELINE_CLASSES = [
    'TextGenerationPipeline',
    'Text2TextGenerationPipeline',
    'SummarizationPipeline',
    'TranslationPipeline',
    'FillMaskPipeline',
    'QuestionAnsweringPipeline',
    'TextClassificationPipeline',
    'TokenClassificationPipeline',
    'ZeroShotClassificationPipeline',
    'FeatureExtractionPipeline',
    'Pipeline',
];
exports.default = OpenlitTransformersInstrumentation;
//# sourceMappingURL=index.js.map