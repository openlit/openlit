import {
  InstrumentationBase,
  InstrumentationModuleDefinition,
  InstrumentationNodeModuleDefinition,
  isWrapped,
} from '@opentelemetry/instrumentation';
import { InstrumentationConfig } from '@opentelemetry/instrumentation';
import { INSTRUMENTATION_PREFIX } from '../../constant';
import SemanticConvention from '../../semantic-convention';
import Mem0Wrapper from './wrapper';

export interface Mem0InstrumentationConfig extends InstrumentationConfig {}

export default class OpenlitMem0Instrumentation extends InstrumentationBase {
  constructor(config: Mem0InstrumentationConfig = {}) {
    super(`${INSTRUMENTATION_PREFIX}/instrumentation-mem0`, '1.0.0', config);
  }

  protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[] {
    const module = new InstrumentationNodeModuleDefinition(
      'mem0ai',
      ['>=0.1.32'],
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

  public manualPatch(mem0: any): void {
    this._patch(mem0);
  }

  protected _patch(moduleExports: any) {
    try {
      // MemoryClient is the primary API-based client for the mem0ai npm package.
      const MemoryClient = moduleExports.MemoryClient;
      if (!MemoryClient?.prototype) return;

      const methods: Array<[string, string]> = [
        ['add', SemanticConvention.DB_OPERATION_ADD],
        ['search', SemanticConvention.DB_OPERATION_SEARCH],
        ['get', SemanticConvention.DB_OPERATION_GET],
        ['getAll', SemanticConvention.DB_OPERATION_FETCH],
        ['update', SemanticConvention.DB_OPERATION_UPDATE],
        ['delete', SemanticConvention.DB_OPERATION_DELETE],
        ['deleteAll', SemanticConvention.DB_OPERATION_DELETE],
        ['history', SemanticConvention.DB_OPERATION_FETCH],
        ['reset', SemanticConvention.DB_OPERATION_DELETE],
      ];

      for (const [method, dbOp] of methods) {
        if (typeof MemoryClient.prototype[method] === 'function') {
          if (isWrapped(MemoryClient.prototype[method])) {
            this._unwrap(MemoryClient.prototype, method);
          }
          this._wrap(
            MemoryClient.prototype,
            method,
            Mem0Wrapper._patchMethod(this.tracer, method, dbOp)
          );
        }
      }
    } catch (e) {
      console.error('Error in Mem0 _patch method:', e);
    }
  }

  protected _unpatch(moduleExports: any) {
    try {
      const MemoryClient = moduleExports.MemoryClient;
      if (!MemoryClient?.prototype) return;
      for (const method of ['add', 'search', 'get', 'getAll', 'update', 'delete', 'deleteAll', 'history', 'reset']) {
        if (typeof MemoryClient.prototype[method] === 'function') {
          this._unwrap(MemoryClient.prototype, method);
        }
      }
    } catch {
      /* ignore */
    }
  }
}
