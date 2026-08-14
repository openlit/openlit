import {
  InstrumentationBase,
  InstrumentationModuleDefinition,
  InstrumentationNodeModuleDefinition,
  isWrapped,
} from '@opentelemetry/instrumentation';
import { InstrumentationConfig } from '@opentelemetry/instrumentation';
import { INSTRUMENTATION_PREFIX } from '../../constant';
import GroqWrapper from './wrapper';

export interface GroqInstrumentationConfig extends InstrumentationConfig {}

export default class OpenlitGroqInstrumentation extends InstrumentationBase {
  constructor(config: GroqInstrumentationConfig = {}) {
    super(`${INSTRUMENTATION_PREFIX}/instrumentation-groq`, '1.0.0', config);
  }

  protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[] {
    const module = new InstrumentationNodeModuleDefinition(
      'groq-sdk',
      ['>=0.5.0'],
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

  public manualPatch(groq: any): void {
    this._patch(groq);
  }

  protected _patch(moduleExports: any) {
    try {
      if (isWrapped(moduleExports.Groq.Chat.Completions.prototype.create)) {
        this._unwrap(moduleExports.Groq.Chat.Completions.prototype, 'create');
      }

      this._wrap(
        moduleExports.Groq.Chat.Completions.prototype,
        'create',
        GroqWrapper._patchChatCompletionCreate(this.tracer)
      );
    } catch (e) {
      console.error('Error in _patch method:', e);
    }
  }

  protected _unpatch(moduleExports: any) {
    this._unwrap(moduleExports.Groq.Chat.Completions.prototype, 'create');
  }
}
