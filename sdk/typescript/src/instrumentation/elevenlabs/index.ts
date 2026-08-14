import {
  InstrumentationBase,
  InstrumentationModuleDefinition,
  InstrumentationNodeModuleDefinition,
  isWrapped,
} from '@opentelemetry/instrumentation';
import { InstrumentationConfig } from '@opentelemetry/instrumentation';
import { diag } from '@opentelemetry/api';
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
      ['>=1.4.0'],
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

    const elevenlabsJsModule = new InstrumentationNodeModuleDefinition(
      '@elevenlabs/elevenlabs-js',
      ['>=1.0.0'],
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

    return [elevenlabsModule, elevenlabsJsModule];
  }

  public manualPatch(elevenlabs: any): void {
    this._patch(elevenlabs);
  }

  protected _patch(moduleExports: any, moduleVersion?: string) {
    try {
      const OriginalElevenLabsClient = moduleExports.ElevenLabsClient;
      if (!OriginalElevenLabsClient || typeof OriginalElevenLabsClient !== 'function') {
        return;
      }

      if (isWrapped(OriginalElevenLabsClient)) {
        this._unwrap(moduleExports, 'ElevenLabsClient');
      }

      const tracer = this.tracer;
      const sdkVersion = moduleVersion ? String(moduleVersion) : undefined;

      this._wrap(moduleExports, 'ElevenLabsClient', (original: (...args: any[]) => any) => {
        return (...clientArgs: any[]) => {
          const client = new (original as any)(...clientArgs);

          if (client && client.textToSpeech) {
            const textToSpeechProto = Object.getPrototypeOf(client.textToSpeech);
            if (textToSpeechProto) {
              this._textToSpeechProto = textToSpeechProto;

              if (textToSpeechProto.convert && !isWrapped(textToSpeechProto.convert)) {
                this._wrap(
                  textToSpeechProto,
                  'convert',
                  ElevenLabsWrapper._patchConvert(tracer, 'convert', sdkVersion)
                );
              }

              if (textToSpeechProto.stream && !isWrapped(textToSpeechProto.stream)) {
                this._wrap(
                  textToSpeechProto,
                  'stream',
                  ElevenLabsWrapper._patchStream(tracer, 'stream', sdkVersion)
                );
              }

              if (textToSpeechProto.convertWithTimestamps && !isWrapped(textToSpeechProto.convertWithTimestamps)) {
                this._wrap(
                  textToSpeechProto,
                  'convertWithTimestamps',
                  ElevenLabsWrapper._patchConvert(tracer, 'convertWithTimestamps', sdkVersion)
                );
              }
            }
          }

          return client;
        };
      });
    } catch (e) {
      diag.error('elevenlabs instrumentation: error in _patch method', e);
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
