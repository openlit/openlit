import {
  InstrumentationBase,
  InstrumentationModuleDefinition,
  InstrumentationNodeModuleDefinition,
  isWrapped,
} from '@opentelemetry/instrumentation';
import { InstrumentationConfig } from '@opentelemetry/instrumentation';
import { INSTRUMENTATION_PREFIX } from '../../constant';
import OllamaWrapper from './wrapper';

export interface OllamaInstrumentationConfig extends InstrumentationConfig {}

export default class OpenlitOllamaInstrumentation extends InstrumentationBase {
  constructor(config: OllamaInstrumentationConfig = {}) {
    super(`${INSTRUMENTATION_PREFIX}/instrumentation-ollama`, '1.0.0', config);
  }

  protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[] {
    const module = new InstrumentationNodeModuleDefinition(
      'ollama',
      ['>= 0.5.8'],
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

  public manualPatch(ollama: any): void {
    this._patch(ollama);
  }

  protected _patch(moduleExports: any) {
    try {
      const proto = moduleExports.Ollama.prototype;

      if (isWrapped(proto.chat)) {
        this._unwrap(proto, 'chat');
      }
      this._wrap(proto, 'chat', OllamaWrapper._patchChat(this.tracer));

      if (typeof proto.generate === 'function') {
        if (isWrapped(proto.generate)) {
          this._unwrap(proto, 'generate');
        }
        this._wrap(proto, 'generate', OllamaWrapper._patchGenerate(this.tracer));
      }

      if (typeof proto.embed === 'function') {
        if (isWrapped(proto.embed)) {
          this._unwrap(proto, 'embed');
        }
        this._wrap(proto, 'embed', OllamaWrapper._patchEmbeddings(this.tracer));
      }

      if (typeof proto.embeddings === 'function') {
        if (isWrapped(proto.embeddings)) {
          this._unwrap(proto, 'embeddings');
        }
        this._wrap(proto, 'embeddings', OllamaWrapper._patchEmbeddings(this.tracer));
      }
    } catch (e) {
      console.error('Error in _patch method:', e);
    }
  }

  protected _unpatch(moduleExports: any) {
    const proto = moduleExports.Ollama.prototype;
    this._unwrap(proto, 'chat');
    if (typeof proto.generate === 'function') {
      this._unwrap(proto, 'generate');
    }
    if (typeof proto.embed === 'function') {
      this._unwrap(proto, 'embed');
    }
    if (typeof proto.embeddings === 'function') {
      this._unwrap(proto, 'embeddings');
    }
  }
}
