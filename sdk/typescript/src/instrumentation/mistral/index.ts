import {
  InstrumentationBase,
  InstrumentationModuleDefinition,
  InstrumentationNodeModuleDefinition,
  isWrapped,
} from '@opentelemetry/instrumentation';
import { InstrumentationConfig } from '@opentelemetry/instrumentation';
import { INSTRUMENTATION_PREFIX } from '../../constant';
import MistralWrapper from './wrapper';

export interface MistralInstrumentationConfig extends InstrumentationConfig {}

export default class OpenlitMistralInstrumentation extends InstrumentationBase {
  constructor(config: MistralInstrumentationConfig = {}) {
    super(`${INSTRUMENTATION_PREFIX}/instrumentation-mistral`, '1.0.0', config);
  }

  protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[] {
    const module = new InstrumentationNodeModuleDefinition(
      '@mistralai/mistralai',
      ['>=1.0.0'],
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

  public manualPatch(mistral: any): void {
    this._patch(mistral);
  }

  protected _patch(moduleExports: any) {
    try {
      // Chat and Embeddings are instance properties in the new SDK — get their
      // prototypes via a dummy instance (no API calls are made at construction time)
      const dummy = new moduleExports.Mistral({ apiKey: 'dummy' });
      const ChatProto = Object.getPrototypeOf(dummy.chat);
      const EmbeddingsProto = Object.getPrototypeOf(dummy.embeddings);

      if (isWrapped(ChatProto.complete)) {
        this._unwrap(ChatProto, 'complete');
      }
      if (isWrapped(ChatProto.stream)) {
        this._unwrap(ChatProto, 'stream');
      }
      if (isWrapped(EmbeddingsProto.create)) {
        this._unwrap(EmbeddingsProto, 'create');
      }

      this._wrap(ChatProto, 'complete', MistralWrapper._patchChatCompletionCreate(this.tracer));
      this._wrap(ChatProto, 'stream', MistralWrapper._patchChatCompletionCreate(this.tracer));
      this._wrap(EmbeddingsProto, 'create', MistralWrapper._patchEmbedding(this.tracer));
    } catch (e) {
      console.error('Error in _patch method:', e);
    }
  }

  protected _unpatch(moduleExports: any) {
    try {
      const dummy = new moduleExports.Mistral({ apiKey: 'dummy' });
      const ChatProto = Object.getPrototypeOf(dummy.chat);
      const EmbeddingsProto = Object.getPrototypeOf(dummy.embeddings);
      this._unwrap(ChatProto, 'complete');
      this._unwrap(ChatProto, 'stream');
      this._unwrap(EmbeddingsProto, 'create');
    } catch (e) {
      console.error('Error in _unpatch method:', e);
    }
  }
}
