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
  private _textToSpeechProto: any = null;

  constructor(config: ElevenLabsInstrumentationConfig = {}) {
    super(`${INSTRUMENTATION_PREFIX}/instrumentation-elevenlabs`, '1.0.0', config);
  }

  protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[] {
    const elevenlabsModule = new InstrumentationNodeModuleDefinition(
      'elevenlabs',
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

    const elevenlabsJsModule = new InstrumentationNodeModuleDefinition(
      '@elevenlabs/elevenlabs-js',
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

    return [elevenlabsModule, elevenlabsJsModule];
  }

  public manualPatch(elevenlabs: any): void {
    this._patch(elevenlabs);
  }

  protected _patch(moduleExports: any) {
    try {
      const OriginalElevenLabsClient = moduleExports.ElevenLabsClient;
      if (!OriginalElevenLabsClient || typeof OriginalElevenLabsClient !== 'function') {
        return;
      }

      if (isWrapped(OriginalElevenLabsClient)) {
        this._unwrap(moduleExports, 'ElevenLabsClient');
      }

      const tracer = this.tracer;
      const self = this;

      this._wrap(moduleExports, 'ElevenLabsClient', (original: (...args: any[]) => any) => {
        return function (this: any, ...args: any[]) {
          const client = new (original as any)(...args);

          if (client && client.textToSpeech) {
            const textToSpeechProto = Object.getPrototypeOf(client.textToSpeech);
            if (textToSpeechProto) {
              self._textToSpeechProto = textToSpeechProto;

              if (textToSpeechProto.convert && !isWrapped(textToSpeechProto.convert)) {
                self._wrap(
                  textToSpeechProto,
                  'convert',
                  ElevenLabsWrapper._patchConvert(tracer, 'convert')
                );
              }

              if (textToSpeechProto.stream && !isWrapped(textToSpeechProto.stream)) {
                self._wrap(
                  textToSpeechProto,
                  'stream',
                  ElevenLabsWrapper._patchStream(tracer, 'stream')
                );
              }

              if (textToSpeechProto.convertWithTimestamps && !isWrapped(textToSpeechProto.convertWithTimestamps)) {
                self._wrap(
                  textToSpeechProto,
                  'convertWithTimestamps',
                  ElevenLabsWrapper._patchConvert(tracer, 'convertWithTimestamps')
                );
              }
            }
          }

          return client;
        };
      });
    } catch (e) {
      console.error('Error in _patch method for ElevenLabs:', e);
    }
  }

  protected _unpatch(moduleExports: any) {
    if (moduleExports.ElevenLabsClient) {
      this._unwrap(moduleExports, 'ElevenLabsClient');
    }
    if (this._textToSpeechProto) {
      if (isWrapped(this._textToSpeechProto.convert)) {
        this._unwrap(this._textToSpeechProto, 'convert');
      }
      if (isWrapped(this._textToSpeechProto.stream)) {
        this._unwrap(this._textToSpeechProto, 'stream');
      }
      if (isWrapped(this._textToSpeechProto.convertWithTimestamps)) {
        this._unwrap(this._textToSpeechProto, 'convertWithTimestamps');
      }
    }
  }
}
