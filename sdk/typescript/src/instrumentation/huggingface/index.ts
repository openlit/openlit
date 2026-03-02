import {
  InstrumentationBase,
  InstrumentationModuleDefinition,
  InstrumentationNodeModuleDefinition,
  isWrapped,
} from '@opentelemetry/instrumentation';
import { InstrumentationConfig } from '@opentelemetry/instrumentation';
import { INSTRUMENTATION_PREFIX } from '../../constant';
import HuggingFaceWrapper from './wrapper';

export interface HuggingFaceInstrumentationConfig extends InstrumentationConfig {}

export default class OpenlitHuggingFaceInstrumentation extends InstrumentationBase {
  constructor(config: HuggingFaceInstrumentationConfig = {}) {
    super(`${INSTRUMENTATION_PREFIX}/instrumentation-huggingface`, '1.0.0', config);
  }

  protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[] {
    const module = new InstrumentationNodeModuleDefinition(
      '@huggingface/inference',
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
    return [module];
  }

  public manualPatch(hf: any): void {
    this._patch(hf);
  }

  protected _patch(moduleExports: any) {
    try {
      // Support both HfInference (v2) and InferenceClient (v3+)
      for (const ClassName of ['HfInference', 'InferenceClient']) {
        const proto = moduleExports[ClassName]?.prototype;
        if (!proto) continue;

        if (typeof proto.chatCompletion === 'function') {
          if (isWrapped(proto.chatCompletion)) {
            this._unwrap(proto, 'chatCompletion');
          }
          this._wrap(proto, 'chatCompletion', HuggingFaceWrapper._patchChatCompletion(this.tracer));
        }

        if (typeof proto.textGeneration === 'function') {
          if (isWrapped(proto.textGeneration)) {
            this._unwrap(proto, 'textGeneration');
          }
          this._wrap(proto, 'textGeneration', HuggingFaceWrapper._patchTextGeneration(this.tracer));
        }
      }
    } catch (e) {
      console.error('Error in HuggingFace _patch method:', e);
    }
  }

  protected _unpatch(moduleExports: any) {
    try {
      for (const ClassName of ['HfInference', 'InferenceClient']) {
        const proto = moduleExports[ClassName]?.prototype;
        if (!proto) continue;
        if (typeof proto.chatCompletion === 'function') {
          this._unwrap(proto, 'chatCompletion');
        }
        if (typeof proto.textGeneration === 'function') {
          this._unwrap(proto, 'textGeneration');
        }
      }
    } catch { /* ignore */ }
  }
}
