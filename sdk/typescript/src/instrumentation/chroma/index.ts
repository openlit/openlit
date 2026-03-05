import {
  InstrumentationBase,
  InstrumentationModuleDefinition,
  InstrumentationNodeModuleDefinition,
  isWrapped,
} from '@opentelemetry/instrumentation';
import { InstrumentationConfig } from '@opentelemetry/instrumentation';
import { INSTRUMENTATION_PREFIX } from '../../constant';
import SemanticConvention from '../../semantic-convention';
import ChromaWrapper from './wrapper';

export interface ChromaInstrumentationConfig extends InstrumentationConfig {}

export default class OpenlitChromaInstrumentation extends InstrumentationBase {
  constructor(config: ChromaInstrumentationConfig = {}) {
    super(`${INSTRUMENTATION_PREFIX}/instrumentation-chroma`, '1.0.0', config);
  }

  protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[] {
    const module = new InstrumentationNodeModuleDefinition(
      'chromadb',
      ['>=1.5.0'],
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

  public manualPatch(chroma: any): void {
    this._patch(chroma);
  }

  protected _patch(moduleExports: any) {
    try {
      const Collection = moduleExports.Collection;
      if (!Collection?.prototype) return;

      const methods: Array<[string, string]> = [
        ['add', SemanticConvention.DB_OPERATION_INSERT],
        ['query', SemanticConvention.DB_OPERATION_QUERY],
        ['get', SemanticConvention.DB_OPERATION_GET],
        ['delete', SemanticConvention.DB_OPERATION_DELETE],
        ['peek', SemanticConvention.DB_OPERATION_PEEK],
        ['update', SemanticConvention.DB_OPERATION_UPDATE],
        ['upsert', SemanticConvention.DB_OPERATION_UPSERT],
      ];

      for (const [method, dbOp] of methods) {
        if (typeof Collection.prototype[method] === 'function') {
          if (isWrapped(Collection.prototype[method])) {
            this._unwrap(Collection.prototype, method);
          }
          this._wrap(Collection.prototype, method, ChromaWrapper._patchCollectionMethod(this.tracer, dbOp));
        }
      }
    } catch (e) {
      console.error('Error in Chroma _patch method:', e);
    }
  }

  protected _unpatch(moduleExports: any) {
    try {
      const Collection = moduleExports.Collection;
      if (!Collection?.prototype) return;
      for (const method of ['add', 'query', 'get', 'delete', 'peek', 'update', 'upsert']) {
        if (typeof Collection.prototype[method] === 'function') {
          this._unwrap(Collection.prototype, method);
        }
      }
    } catch { /* ignore */ }
  }
}

