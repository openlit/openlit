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

const TTS_METHODS = [
  'convert',
  'convertAsStream',
  'stream',
  'convertWithTimestamps',
  'streamWithTimestamps',
];

export default class OpenlitElevenLabsInstrumentation extends InstrumentationBase {
  constructor(config: ElevenLabsInstrumentationConfig = {}) {
    super(`${INSTRUMENTATION_PREFIX}/instrumentation-elevenlabs`, '1.0.0', config);
  }

  protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[] {
    return ['elevenlabs', '@elevenlabs/elevenlabs-js'].map(
      (moduleName) =>
        new InstrumentationNodeModuleDefinition(
          moduleName,
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
        )
    );
  }

  public manualPatch(elevenlabs: any): void {
    this._patch(elevenlabs);
  }

  private safeWrap(target: any, method: string, patcher: (tracer: any) => any): void {
    if (!target?.[method]) return;
    if (isWrapped(target[method])) {
      this._unwrap(target, method);
    }
    this._wrap(target, method, patcher(this.tracer));
  }

  private safeUnwrap(target: any, method: string): void {
    if (target?.[method] && isWrapped(target[method])) {
      this._unwrap(target, method);
    }
  }

  private getTextToSpeechPrototypes(moduleExports: any): any[] {
    const api = moduleExports?.ElevenLabs ?? moduleExports;
    const candidates = [
      api?.textToSpeech?.TextToSpeech,
      api?.textToSpeech?.TextToSpeechClient,
      moduleExports?.textToSpeech?.TextToSpeech,
      moduleExports?.textToSpeech?.TextToSpeechClient,
      moduleExports?.TextToSpeech,
      moduleExports?.TextToSpeechClient,
    ];

    return [...new Set(candidates.map((candidate) => candidate?.prototype).filter(Boolean))];
  }

  private getElevenLabsClientPrototype(moduleExports: any): any {
    const client =
      moduleExports?.ElevenLabsClient ??
      moduleExports?.default?.ElevenLabsClient ??
      moduleExports?.ElevenLabs?.ElevenLabsClient;
    return client?.prototype;
  }

  protected _patch(moduleExports: any) {
    try {
      for (const proto of this.getTextToSpeechPrototypes(moduleExports)) {
        for (const method of TTS_METHODS) {
          this.safeWrap(proto, method, (tracer) =>
            ElevenLabsWrapper._patchConvert(tracer, method)
          );
        }
      }

      this.safeWrap(
        this.getElevenLabsClientPrototype(moduleExports),
        'generate',
        ElevenLabsWrapper._patchGenerate
      );
    } catch (e) {
      console.error('Error in ElevenLabs _patch method:', e);
    }
  }

  protected _unpatch(moduleExports: any) {
    for (const proto of this.getTextToSpeechPrototypes(moduleExports)) {
      for (const method of TTS_METHODS) {
        this.safeUnwrap(proto, method);
      }
    }
    this.safeUnwrap(this.getElevenLabsClientPrototype(moduleExports), 'generate');
  }
}
