import {
  InstrumentationBase,
  InstrumentationModuleDefinition,
  InstrumentationNodeModuleDefinition,
  isWrapped,
} from '@opentelemetry/instrumentation';
import { InstrumentationConfig } from '@opentelemetry/instrumentation';
import { INSTRUMENTATION_PREFIX } from '../../constant';
import QdrantWrapper from './wrapper';

export interface QdrantInstrumentationConfig extends InstrumentationConfig {}

export default class OpenlitQdrantInstrumentation extends InstrumentationBase {
  constructor(config: QdrantInstrumentationConfig = {}) {
    super(`${INSTRUMENTATION_PREFIX}/instrumentation-qdrant`, '1.0.0', config);
  }

  protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[] {
    const module = new InstrumentationNodeModuleDefinition(
      '@qdrant/js-client-rest',
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

  public manualPatch(qdrant: any): void {
    this._patch(qdrant);
  }

  protected _patch(moduleExports: any) {
    try {
      const QdrantClient = moduleExports.QdrantClient;
      if (!QdrantClient?.prototype) return;

      const patchMap: Array<[string, (tracer: any) => any]> = [
        ['search', QdrantWrapper._patchSearch.bind(QdrantWrapper)],
        ['upsert', QdrantWrapper._patchUpsert.bind(QdrantWrapper)],
        ['delete', QdrantWrapper._patchDelete.bind(QdrantWrapper)],
        ['retrieve', QdrantWrapper._patchRetrieve.bind(QdrantWrapper)],
        ['scroll', QdrantWrapper._patchScroll.bind(QdrantWrapper)],
      ];

      for (const [method, patchFn] of patchMap) {
        if (typeof QdrantClient.prototype[method] === 'function') {
          if (isWrapped(QdrantClient.prototype[method])) {
            this._unwrap(QdrantClient.prototype, method);
          }
          this._wrap(QdrantClient.prototype, method, patchFn(this.tracer));
        }
      }
    } catch (e) {
      console.error('Error in Qdrant _patch method:', e);
    }
  }

  protected _unpatch(moduleExports: any) {
    try {
      const QdrantClient = moduleExports.QdrantClient;
      if (!QdrantClient?.prototype) return;
      for (const method of ['search', 'upsert', 'delete', 'retrieve', 'scroll']) {
        if (typeof QdrantClient.prototype[method] === 'function') {
          this._unwrap(QdrantClient.prototype, method);
        }
      }
    } catch { /* ignore */ }
  }
}
