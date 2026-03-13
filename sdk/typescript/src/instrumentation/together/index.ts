import {
  InstrumentationBase,
  InstrumentationModuleDefinition,
  InstrumentationNodeModuleDefinition,
  isWrapped,
} from '@opentelemetry/instrumentation';
import { InstrumentationConfig } from '@opentelemetry/instrumentation';
import { INSTRUMENTATION_PREFIX } from '../../constant';
import TogetherWrapper from './wrapper';

export interface TogetherInstrumentationConfig extends InstrumentationConfig {}

export default class OpenlitTogetherInstrumentation extends InstrumentationBase {
  constructor(config: TogetherInstrumentationConfig = {}) {
    super(`${INSTRUMENTATION_PREFIX}/instrumentation-together`, '1.0.0', config);
  }

  protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[] {
    const module = new InstrumentationNodeModuleDefinition(
      'together-ai',
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

  public manualPatch(together: any): void {
    this._patch(together);
  }

  protected _patch(moduleExports: any) {
    try {
      if (isWrapped(moduleExports.Together.Chat.Completions.prototype.create)) {
        this._unwrap(moduleExports.Together.Chat.Completions.prototype, 'create');
      }

      this._wrap(
        moduleExports.Together.Chat.Completions.prototype,
        'create',
        TogetherWrapper._patchChatCompletionCreate(this.tracer)
      );
    } catch (e) {
      console.error('Error in _patch method:', e);
    }
  }

  protected _unpatch(moduleExports: any) {
    this._unwrap(moduleExports.Together.Chat.Completions.prototype, 'create');
  }
}
