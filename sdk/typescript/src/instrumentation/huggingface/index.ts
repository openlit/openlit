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

  // Originals saved for unpatch (v4+)
  private _origTaskFns: Record<string, any> = {};

  private _findLeafModule(namePart: string): Record<string, any> | null {
    try {
      const cache = (require as any).cache as Record<string, any>;
      const key = Object.keys(cache).find(k =>
        k.includes('@huggingface') &&
        k.includes('inference') &&
        k.endsWith(`${namePart}.js`) &&
        !k.endsWith('Stream.js')
      );
      return key ? cache[key].exports : null;
    } catch {
      return null;
    }
  }

  protected _patch(moduleExports: any) {
    try {
      const tracer = this.tracer;

      // v4+: InferenceClient sets task methods as non-configurable own properties in
      // its constructor, capturing them from leaf task modules via a getter chain.
      // Patching the leaf modules (writable exports) propagates through the getters
      // so new instances capture the patched functions.
      const chatMod = this._findLeafModule('chatCompletion');
      if (chatMod && typeof chatMod.chatCompletion === 'function' && !chatMod.__openlit_hf_patched) {
        this._origTaskFns.chatCompletion = chatMod.chatCompletion;
        chatMod.chatCompletion = HuggingFaceWrapper._patchChatCompletion(tracer)(chatMod.chatCompletion);
        chatMod.__openlit_hf_patched = true;
      }
      const textMod = this._findLeafModule('textGeneration');
      if (textMod && typeof textMod.textGeneration === 'function' && !textMod.__openlit_hf_patched) {
        this._origTaskFns.textGeneration = textMod.textGeneration;
        textMod.textGeneration = HuggingFaceWrapper._patchTextGeneration(tracer)(textMod.textGeneration);
        textMod.__openlit_hf_patched = true;
      }

      // v2/v3: Methods on the prototype
      for (const ClassName of ['HfInference', 'InferenceClient']) {
        const proto = moduleExports[ClassName]?.prototype;
        if (!proto) continue;
        if (typeof proto.chatCompletion === 'function') {
          if (isWrapped(proto.chatCompletion)) this._unwrap(proto, 'chatCompletion');
          this._wrap(proto, 'chatCompletion', HuggingFaceWrapper._patchChatCompletion(tracer));
        }
        if (typeof proto.textGeneration === 'function') {
          if (isWrapped(proto.textGeneration)) this._unwrap(proto, 'textGeneration');
          this._wrap(proto, 'textGeneration', HuggingFaceWrapper._patchTextGeneration(tracer));
        }
      }
    } catch (e) {
      console.error('Error in HuggingFace _patch method:', e);
    }
  }

  protected _unpatch(moduleExports: any) {
    try {
      // Restore leaf module originals (v4+)
      const chatMod = this._findLeafModule('chatCompletion');
      if (chatMod && this._origTaskFns.chatCompletion) {
        chatMod.chatCompletion = this._origTaskFns.chatCompletion;
        delete chatMod.__openlit_hf_patched;
      }
      const textMod = this._findLeafModule('textGeneration');
      if (textMod && this._origTaskFns.textGeneration) {
        textMod.textGeneration = this._origTaskFns.textGeneration;
        delete textMod.__openlit_hf_patched;
      }
      // Restore prototype methods (v2/v3)
      for (const ClassName of ['HfInference', 'InferenceClient']) {
        const proto = moduleExports[ClassName]?.prototype;
        if (!proto) continue;
        if (isWrapped(proto.chatCompletion)) this._unwrap(proto, 'chatCompletion');
        if (isWrapped(proto.textGeneration)) this._unwrap(proto, 'textGeneration');
      }
    } catch { /* ignore */ }
  }
}
