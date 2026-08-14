import {
  InstrumentationBase,
  InstrumentationModuleDefinition,
  InstrumentationNodeModuleDefinition,
  isWrapped,
} from '@opentelemetry/instrumentation';
import { InstrumentationConfig } from '@opentelemetry/instrumentation';
import { INSTRUMENTATION_PREFIX } from '../../constant';
import GoogleAIWrapper from './wrapper';

export interface GoogleAIInstrumentationConfig extends InstrumentationConfig {}

export default class OpenlitGoogleAIInstrumentation extends InstrumentationBase {
  constructor(config: GoogleAIInstrumentationConfig = {}) {
    super(`${INSTRUMENTATION_PREFIX}/instrumentation-google-ai`, '1.0.0', config);
  }

  protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[] {
    const module = new InstrumentationNodeModuleDefinition(
      '@google/generative-ai',
      ['>=0.1.0'],
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

  public manualPatch(googleAI: any): void {
    this._patch(googleAI);
  }

  protected _patch(moduleExports: any) {
    try {
      if (isWrapped(moduleExports.GenerativeModel.prototype.generateContent)) {
        this._unwrap(moduleExports.GenerativeModel.prototype, 'generateContent');
      }
      if (isWrapped(moduleExports.GenerativeModel.prototype.generateContentStream)) {
        this._unwrap(moduleExports.GenerativeModel.prototype, 'generateContentStream');
      }

      this._wrap(
        moduleExports.GenerativeModel.prototype,
        'generateContent',
        GoogleAIWrapper._patchGenerateContent(this.tracer)
      );

      this._wrap(
        moduleExports.GenerativeModel.prototype,
        'generateContentStream',
        GoogleAIWrapper._patchGenerateContent(this.tracer)
      );
    } catch (e) {
      console.error('Error in _patch method:', e);
    }
  }

  protected _unpatch(moduleExports: any) {
    this._unwrap(moduleExports.GenerativeModel.prototype, 'generateContent');
    this._unwrap(moduleExports.GenerativeModel.prototype, 'generateContentStream');
  }
}
