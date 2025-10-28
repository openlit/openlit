import {
  InstrumentationBase,
  InstrumentationModuleDefinition,
  InstrumentationNodeModuleDefinition,
  isWrapped,
} from '@opentelemetry/instrumentation';
import { InstrumentationConfig } from '@opentelemetry/instrumentation';
import { INSTRUMENTATION_PREFIX } from '../../constant';
import MistralClient from '@mistralai/mistralai';
import MistralWrapper from './wrapper';

export interface MistralInstrumentationConfig extends InstrumentationConfig {}

export default class OpenlitMistralInstrumentation extends InstrumentationBase {
  constructor(config: MistralInstrumentationConfig = {}) {
    super(`${INSTRUMENTATION_PREFIX}/instrumentation-mistral`, '1.0.0', config);
  }

  protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[] {
    const module = new InstrumentationNodeModuleDefinition(
      '@mistralai/mistralai',
      ['>= 0.4.0'],
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

  protected _patch(moduleExports: typeof MistralClient) {
    try {
      if (isWrapped((moduleExports as any).prototype.chat)) {
        this._unwrap((moduleExports as any).prototype, 'chat');
      }
      if ((moduleExports as any).prototype.chatStream && isWrapped((moduleExports as any).prototype.chatStream)) {
        this._unwrap((moduleExports as any).prototype, 'chatStream');
      }
      if ((moduleExports as any).prototype.embeddings && isWrapped((moduleExports as any).prototype.embeddings)) {
        this._unwrap((moduleExports as any).prototype, 'embeddings');
      }

      this._wrap((moduleExports as any).prototype, 'chat', MistralWrapper._patchChat(this.tracer));
      // chatStream is optional; patch if present at runtime
      if ((moduleExports as any).prototype.chatStream) {
        this._wrap(
          (moduleExports as any).prototype,
          'chatStream',
          MistralWrapper._patchChatStream(this.tracer)
        );
      }
      if ((moduleExports as any).prototype.embeddings) {
        this._wrap(
          (moduleExports as any).prototype,
          'embeddings',
          MistralWrapper._patchEmbeddings(this.tracer)
        );
      }
    } catch (e) {
      console.error('Error in _patch method:', e);
    }
  }

  protected _unpatch(moduleExports: typeof MistralClient) {
    this._unwrap((moduleExports as any).prototype, 'chat');
    try {
      this._unwrap((moduleExports as any).prototype, 'chatStream');
    } catch {}
    try {
      this._unwrap((moduleExports as any).prototype, 'embeddings');
    } catch {}
  }
}
