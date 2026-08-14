import {
  InstrumentationBase,
  InstrumentationModuleDefinition,
  InstrumentationNodeModuleDefinition,
  isWrapped,
} from '@opentelemetry/instrumentation';
import { InstrumentationConfig } from '@opentelemetry/instrumentation';
import { diag } from '@opentelemetry/api';
import { INSTRUMENTATION_PREFIX } from '../../constant';
import TransformersWrapper from './wrapper';

export interface TransformersInstrumentationConfig extends InstrumentationConfig {}

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
  constructor(config: TransformersInstrumentationConfig = {}) {
    super(`${INSTRUMENTATION_PREFIX}/instrumentation-transformers`, '1.0.0', config);
  }

  protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[] {
    const makeDef = (packageName: string) =>
      new InstrumentationNodeModuleDefinition(
        packageName,
        ['>=2.0.0'],
        (moduleExports, moduleVersion) => {
          this._patch(moduleExports, moduleVersion);
          return moduleExports;
        },
        (moduleExports) => {
          if (moduleExports !== undefined) {
            this._unpatch(moduleExports);
          }
        }
      );

    return [makeDef('@huggingface/transformers'), makeDef('@xenova/transformers')];
  }

  public manualPatch(transformers: any): void {
    this._patch(transformers);
  }

  /**
   * Pipeline subclasses whose `_call` we patch. Most specific first; the base
   * `Pipeline` is the final fallback. Subclasses that inherit `_call` from an
   * ancestor in this list are covered by that ancestor's patch (the operation
   * is resolved from the live instance's `task`, so the span stays correct).
   */
  private static readonly PIPELINE_CLASSES = [
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

  protected _patch(moduleExports: any, moduleVersion?: string) {
    try {
      const tracer = this.tracer;
      const sdkVersion = moduleVersion ? String(moduleVersion) : undefined;
      let patched = false;

      for (const className of OpenlitTransformersInstrumentation.PIPELINE_CLASSES) {
        const PipelineClass = moduleExports[className];
        const proto = PipelineClass?.prototype;
        if (!proto) continue;

        // Only patch a class that defines its OWN `_call`, so each distinct
        // implementation is wrapped exactly once. Subclasses that inherit
        // `_call` reuse the ancestor's wrapped method.
        if (!Object.prototype.hasOwnProperty.call(proto, '_call')) continue;
        if (typeof proto._call !== 'function') continue;
        if (isWrapped(proto._call)) {
          this._unwrap(proto, '_call');
        }
        this._wrap(proto, '_call', TransformersWrapper._patchPipelineCall(tracer, className, sdkVersion));
        patched = true;
      }

      // Fallback: if no Pipeline subclass exposed `_call` (very old or very new
      // SDK internals), wrap the `pipeline()` factory instead.
      if (!patched && typeof moduleExports.pipeline === 'function') {
        if (!isWrapped(moduleExports.pipeline)) {
          this._wrap(moduleExports, 'pipeline', TransformersWrapper._patchPipelineFactory(tracer, sdkVersion));
        }
      }
    } catch (e) {
      diag.error('transformers instrumentation: error in _patch method', e);
    }
  }

  protected _unpatch(moduleExports: any) {
    try {
      for (const className of OpenlitTransformersInstrumentation.PIPELINE_CLASSES) {
        const proto = moduleExports[className]?.prototype;
        if (!proto) continue;
        if (Object.prototype.hasOwnProperty.call(proto, '_call') && isWrapped(proto._call)) {
          this._unwrap(proto, '_call');
        }
      }
      if (isWrapped(moduleExports.pipeline)) {
        this._unwrap(moduleExports, 'pipeline');
      }
    } catch (e) {
      diag.error('transformers instrumentation: error in _unpatch method', e);
    }
  }
}
