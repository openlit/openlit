import {
  InstrumentationBase,
  InstrumentationModuleDefinition,
  InstrumentationNodeModuleDefinition,
  isWrapped,
} from '@opentelemetry/instrumentation';
import { InstrumentationConfig } from '@opentelemetry/instrumentation';
import { INSTRUMENTATION_PREFIX } from '../../constant';
import ReplicateWrapper from './wrapper';

export interface ReplicateInstrumentationConfig extends InstrumentationConfig {}

export default class OpenlitReplicateInstrumentation extends InstrumentationBase {
  constructor(config: ReplicateInstrumentationConfig = {}) {
    super(`${INSTRUMENTATION_PREFIX}/instrumentation-replicate`, '1.0.0', config);
  }

  protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[] {
    const module = new InstrumentationNodeModuleDefinition(
      'replicate',
      ['>=0.25.0'],
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

  public manualPatch(replicate: any): void {
    this._patch(replicate);
  }

  protected _patch(moduleExports: any) {
    try {
      // Replicate can be default export (ESM) or module itself (CJS)
      const ReplicateClass = moduleExports.default ?? moduleExports.Replicate ?? moduleExports;
      const proto = ReplicateClass?.prototype;
      if (!proto) return;

      if (typeof proto.run === 'function') {
        if (isWrapped(proto.run)) {
          this._unwrap(proto, 'run');
        }
        this._wrap(proto, 'run', ReplicateWrapper._patchRun(this.tracer));
      }
    } catch (e) {
      console.error('Error in Replicate _patch method:', e);
    }
  }

  protected _unpatch(moduleExports: any) {
    try {
      const ReplicateClass = moduleExports.default ?? moduleExports.Replicate ?? moduleExports;
      const proto = ReplicateClass?.prototype;
      if (proto && typeof proto.run === 'function') {
        this._unwrap(proto, 'run');
      }
    } catch { /* ignore */ }
  }
}
