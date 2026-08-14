import {
  InstrumentationBase,
  InstrumentationModuleDefinition,
  InstrumentationNodeModuleDefinition,
  isWrapped,
} from '@opentelemetry/instrumentation';
import { InstrumentationConfig } from '@opentelemetry/instrumentation';
import { diag } from '@opentelemetry/api';
import { INSTRUMENTATION_PREFIX } from '../../constant';
import SemanticConvention from '../../semantic-convention';
import AstraWrapper from './wrapper';

export interface AstraInstrumentationConfig extends InstrumentationConfig {}

export default class OpenlitAstraInstrumentation extends InstrumentationBase {
  constructor(config: AstraInstrumentationConfig = {}) {
    super(`${INSTRUMENTATION_PREFIX}/instrumentation-astra`, '1.0.0', config);
  }

  protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[] {
    const module = new InstrumentationNodeModuleDefinition(
      '@datastax/astra-db-ts',
      ['>=1.0.0'],
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

  public manualPatch(astra: any): void {
    this._patch(astra);
  }

  protected _patch(moduleExports: any) {
    try {
      const Collection = moduleExports.Collection;
      if (!Collection?.prototype) return;

      // `find` returns a cursor synchronously — must not be wrapped as async
      if (typeof Collection.prototype['find'] === 'function') {
        if (isWrapped(Collection.prototype['find'])) {
          this._unwrap(Collection.prototype, 'find');
        }
        this._wrap(Collection.prototype, 'find', AstraWrapper._patchSyncFindMethod(this.tracer));
      }

      // All other methods return Promises and use the async wrapper
      const asyncMethods: Array<[string, string]> = [
        ['insertOne', SemanticConvention.DB_OPERATION_INSERT],
        ['insertMany', SemanticConvention.DB_OPERATION_INSERT],
        ['updateOne', SemanticConvention.DB_OPERATION_UPDATE],
        ['updateMany', SemanticConvention.DB_OPERATION_UPDATE],
        ['replaceOne', SemanticConvention.DB_OPERATION_REPLACE],
        ['findOne', SemanticConvention.DB_OPERATION_SELECT],
        ['findOneAndUpdate', SemanticConvention.DB_OPERATION_REPLACE],
        ['findOneAndReplace', SemanticConvention.DB_OPERATION_REPLACE],
        ['findOneAndDelete', SemanticConvention.DB_OPERATION_FIND_AND_DELETE],
        ['deleteOne', SemanticConvention.DB_OPERATION_DELETE],
        ['deleteMany', SemanticConvention.DB_OPERATION_DELETE],
      ];

      for (const [method, dbOp] of asyncMethods) {
        if (typeof Collection.prototype[method] === 'function') {
          if (isWrapped(Collection.prototype[method])) {
            this._unwrap(Collection.prototype, method);
          }
          this._wrap(Collection.prototype, method, AstraWrapper._patchCollectionMethod(this.tracer, dbOp));
        }
      }
    } catch (e) {
      diag.error('Astra instrumentation: error in _patch method', e);
    }
  }

  protected _unpatch(moduleExports: any) {
    try {
      const Collection = moduleExports.Collection;
      if (!Collection?.prototype) return;
      for (const method of [
        'insertOne', 'insertMany', 'updateOne', 'updateMany', 'replaceOne',
        'find', 'findOne', 'findOneAndUpdate', 'findOneAndReplace',
        'findOneAndDelete', 'deleteOne', 'deleteMany',
      ]) {
        if (typeof Collection.prototype[method] === 'function') {
          this._unwrap(Collection.prototype, method);
        }
      }
    } catch { /* ignore */ }
  }
}
