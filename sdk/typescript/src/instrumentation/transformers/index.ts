import {
  InstrumentationBase,
  InstrumentationModuleDefinition,
  InstrumentationNodeModuleDefinition,
  isWrapped,
} from '@opentelemetry/instrumentation';
import { InstrumentationConfig } from '@opentelemetry/instrumentation';
import { INSTRUMENTATION_PREFIX } from '../../constant';
import TransformersWrapper from './wrapper';

export interface TransformersInstrumentationConfig extends InstrumentationConfig {}

/**
 * Instruments local HuggingFace inference via the Transformers.js SDK.
 *
 * Supported packages (registered as separate module definitions so either
 * package name triggers instrumentation):
 *   - `@xenova/transformers` (older name)
 *   - `@huggingface/transformers` (current name, v3+)
 *
 * The Python reference instruments `transformers.TextGenerationPipeline.__call__`.
 * Here we patch the `_call` method on the `TextGenerationPipeline` prototype,
 * which is the method invoked when a user calls `pipe(input, options)`.
 * We also attempt to patch the base `Pipeline.prototype._call` so that any
 * pipeline type emits a span.
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
        (moduleExports) => {
          this._patch(moduleExports);
          return moduleExports;
        },
        (moduleExports) => {
          if (moduleExports !== undefined) {
            this._unpatch(moduleExports);
          }
        }
      );

    return [
      makeDef('@xenova/transformers'),
      makeDef('@huggingface/transformers'),
    ];
  }

  public manualPatch(transformers: any): void {
    this._patch(transformers);
  }

  /**
   * Pipeline classes to patch, in order of specificity.
   * If a class is not present (older SDK versions), we skip it gracefully.
   */
  private static readonly PIPELINE_CLASSES = [
    'TextGenerationPipeline',
    'Text2TextGenerationPipeline',
    'SummarizationPipeline',
    'QuestionAnsweringPipeline',
    'TextClassificationPipeline',
    'TokenClassificationPipeline',
    'TranslationPipeline',
    'ZeroShotClassificationPipeline',
    'FeatureExtractionPipeline',
    // Base class last (broadest catch)
    'Pipeline',
  ];

  protected _patch(moduleExports: any) {
    try {
      const tracer = this.tracer;
      let patched = false;

      for (const className of OpenlitTransformersInstrumentation.PIPELINE_CLASSES) {
        const PipelineClass = moduleExports[className];
        if (!PipelineClass?.prototype) continue;

        const proto = PipelineClass.prototype;

        // Transformers.js uses `_call` as the internal method invoked when the
        // pipeline object is used as a function via its Proxy wrapper.
        if (typeof proto._call === 'function') {
          if (isWrapped(proto._call)) {
            this._unwrap(proto, '_call');
          }
          this._wrap(proto, '_call', TransformersWrapper._patchPipelineCall(tracer, className));
          patched = true;
          // Only patch the most specific class found; the base Pipeline._call
          // is the final fallback.
          if (className !== 'Pipeline') break;
        }
      }

      // If nothing was patched (e.g., very old or very new SDK with different
      // internal structure), try patching the pipeline factory instead.
      if (!patched && typeof moduleExports.pipeline === 'function') {
        if (!isWrapped(moduleExports.pipeline)) {
          this._wrap(
            moduleExports,
            'pipeline',
            TransformersWrapper._patchPipelineFactory(tracer)
          );
        }
      }
    } catch (e) {
      console.error('Error in Transformers _patch method:', e);
    }
  }

  protected _unpatch(moduleExports: any) {
    try {
      for (const className of OpenlitTransformersInstrumentation.PIPELINE_CLASSES) {
        const PipelineClass = moduleExports[className];
        if (!PipelineClass?.prototype) continue;
        const proto = PipelineClass.prototype;
        if (isWrapped(proto._call)) {
          this._unwrap(proto, '_call');
        }
      }
      if (isWrapped(moduleExports.pipeline)) {
        this._unwrap(moduleExports, 'pipeline');
      }
    } catch {
      /* ignore */
    }
  }
}
