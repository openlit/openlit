import {
  InstrumentationBase,
  InstrumentationModuleDefinition,
  InstrumentationNodeModuleDefinition,
  isWrapped,
} from '@opentelemetry/instrumentation';
import { InstrumentationConfig } from '@opentelemetry/instrumentation';
import { INSTRUMENTATION_PREFIX } from '../../constant';
import TypeSafeWrapper from './wrapper';

export interface TypeSafeInstrumentationConfig extends InstrumentationConfig {}

function typeSafeClient(moduleExports: any): any {
  return moduleExports?.TypeSafeClient || moduleExports?.default?.TypeSafeClient;
}

export default class OpenlitTypeSafeInstrumentation extends InstrumentationBase {
  constructor(config: TypeSafeInstrumentationConfig = {}) {
    super(`${INSTRUMENTATION_PREFIX}/instrumentation-typesafe`, '1.0.0', config);
  }

  protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[] {
    const module = new InstrumentationNodeModuleDefinition(
      '@typesafe-ai/sdk',
      ['>=0.6.0'],
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

  public manualPatch(typesafe: any): void {
    this._patch(typesafe);
  }

  protected _patch(moduleExports: any) {
    try {
      const Client = typeSafeClient(moduleExports);
      if (!Client?.prototype?.systemOne) {
        return;
      }
      if (isWrapped(Client.prototype.systemOne)) {
        this._unwrap(Client.prototype, 'systemOne');
      }
      this._wrap(Client.prototype, 'systemOne', TypeSafeWrapper._patchSystemOne(this.tracer));
    } catch (e) {
      console.error('Error in TypeSafe _patch method:', e);
    }
  }

  protected _unpatch(moduleExports: any) {
    const Client = typeSafeClient(moduleExports);
    if (Client?.prototype?.systemOne) {
      this._unwrap(Client.prototype, 'systemOne');
    }
  }
}
