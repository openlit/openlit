import {
  InstrumentationBase,
  InstrumentationModuleDefinition,
  InstrumentationNodeModuleDefinition,
  isWrapped,
} from '@opentelemetry/instrumentation';
import { InstrumentationConfig } from '@opentelemetry/instrumentation';
import { INSTRUMENTATION_PREFIX } from '../../constant';
import ElevenLabsWrapper from './wrapper';

export interface ElevenLabsInstrumentationConfig extends InstrumentationConfig {}

export default class OpenlitElevenLabsInstrumentation extends InstrumentationBase {
  constructor(config: ElevenLabsInstrumentationConfig = {}) {
    super(`${INSTRUMENTATION_PREFIX}/instrumentation-elevenlabs`, '1.0.0', config);
  }

  protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[] {
    const module = new InstrumentationNodeModuleDefinition(
      'elevenlabs',
      ['>=1.4.0'],
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

  public manualPatch(elevenlabs: any): void {
    this._patch(elevenlabs);
  }

  protected _patch(moduleExports: any) {
    try {
      // ElevenLabsClient exposes textToSpeech as an instance property.
      // Get the prototype via a dummy instance (no API calls at construction time).
      const ClientClass = moduleExports.ElevenLabsClient;
      if (!ClientClass) return;

      const dummy = new ClientClass({ apiKey: 'dummy' });

      // textToSpeech.convert — the primary TTS method
      const ttsProto = dummy.textToSpeech ? Object.getPrototypeOf(dummy.textToSpeech) : null;
      if (ttsProto && typeof ttsProto.convert === 'function') {
        if (isWrapped(ttsProto.convert)) {
          this._unwrap(ttsProto, 'convert');
        }
        this._wrap(ttsProto, 'convert', ElevenLabsWrapper._patchTextToSpeechConvert(this.tracer));
      }

      // generate — alternative top-level method on some SDK versions
      if (typeof ClientClass.prototype.generate === 'function') {
        if (isWrapped(ClientClass.prototype.generate)) {
          this._unwrap(ClientClass.prototype, 'generate');
        }
        this._wrap(
          ClientClass.prototype,
          'generate',
          ElevenLabsWrapper._patchGenerate(this.tracer)
        );
      }
    } catch (e) {
      console.error('Error in ElevenLabs _patch method:', e);
    }
  }

  protected _unpatch(moduleExports: any) {
    try {
      const ClientClass = moduleExports.ElevenLabsClient;
      if (!ClientClass) return;

      const dummy = new ClientClass({ apiKey: 'dummy' });
      const ttsProto = dummy.textToSpeech ? Object.getPrototypeOf(dummy.textToSpeech) : null;
      if (ttsProto && isWrapped(ttsProto.convert)) {
        this._unwrap(ttsProto, 'convert');
      }
      if (isWrapped(ClientClass.prototype.generate)) {
        this._unwrap(ClientClass.prototype, 'generate');
      }
    } catch {
      /* ignore */
    }
  }
}
