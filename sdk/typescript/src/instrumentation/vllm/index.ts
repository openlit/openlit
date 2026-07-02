import {
  InstrumentationBase,
  InstrumentationModuleDefinition,
  InstrumentationNodeModuleDefinition,
  isWrapped,
} from '@opentelemetry/instrumentation';
import { InstrumentationConfig } from '@opentelemetry/instrumentation';
import { INSTRUMENTATION_PREFIX } from '../../constant';
import VllmWrapper from './wrapper';

export interface VllmInstrumentationConfig extends InstrumentationConfig {}

export default class OpenlitVllmInstrumentation extends InstrumentationBase {
  constructor(config: VllmInstrumentationConfig = {}) {
    super(`${INSTRUMENTATION_PREFIX}/instrumentation-vllm`, '1.0.0', config);
  }

  protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[] {
    const module = new InstrumentationNodeModuleDefinition(
      'openai',
      ['>=3.1.0'],
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

  public manualPatch(openai: any): void {
    this._patch(openai);
  }

  protected _patch(moduleExports: any) {
    try {
      const proto = moduleExports.OpenAI.Chat.Completions.prototype;

      if (isWrapped(proto.create)) {
        this._unwrap(proto, 'create');
      }
      this._wrap(proto, 'create', VllmWrapper._patchChat(this.tracer));
    } catch (e) {
      console.error('Error in vllm _patch method:', e);
    }
  }

  protected _unpatch(moduleExports: any) {
    this._unwrap(moduleExports.OpenAI.Chat.Completions.prototype, 'create');
  }
}