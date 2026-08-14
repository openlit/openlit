import {
  InstrumentationBase,
  InstrumentationModuleDefinition,
  InstrumentationNodeModuleDefinition,
  isWrapped,
} from '@opentelemetry/instrumentation';
import { InstrumentationConfig } from '@opentelemetry/instrumentation';
import { INSTRUMENTATION_PREFIX } from '../../constant';
import MilvusWrapper from './wrapper';

export interface MilvusInstrumentationConfig extends InstrumentationConfig {}

export default class OpenlitMilvusInstrumentation extends InstrumentationBase {
  constructor(config: MilvusInstrumentationConfig = {}) {
    super(`${INSTRUMENTATION_PREFIX}/instrumentation-milvus`, '1.0.0', config);
  }

  protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[] {
    const module = new InstrumentationNodeModuleDefinition(
      '@zilliz/milvus2-sdk-node',
      ['>=2.0.0'],
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

  public manualPatch(milvus: any): void {
    this._patch(milvus);
  }

  protected _patch(moduleExports: any) {
    try {
      const MilvusClient = moduleExports.MilvusClient;
      if (!MilvusClient?.prototype) return;

      const patchMap: Array<[string, (tracer: any) => any]> = [
        ['search', MilvusWrapper._patchSearch.bind(MilvusWrapper)],
        ['insert', MilvusWrapper._patchInsert.bind(MilvusWrapper)],
        ['delete', MilvusWrapper._patchDelete.bind(MilvusWrapper)],
        ['query', MilvusWrapper._patchQuery.bind(MilvusWrapper)],
        ['upsert', MilvusWrapper._patchUpsert.bind(MilvusWrapper)],
      ];

      for (const [method, patchFn] of patchMap) {
        if (typeof MilvusClient.prototype[method] === 'function') {
          if (isWrapped(MilvusClient.prototype[method])) {
            this._unwrap(MilvusClient.prototype, method);
          }
          this._wrap(MilvusClient.prototype, method, patchFn(this.tracer));
        }
      }
    } catch (e) {
      console.error('Error in Milvus _patch method:', e);
    }
  }

  protected _unpatch(moduleExports: any) {
    try {
      const MilvusClient = moduleExports.MilvusClient;
      if (!MilvusClient?.prototype) return;
      for (const method of ['search', 'insert', 'delete', 'query', 'upsert']) {
        if (typeof MilvusClient.prototype[method] === 'function') {
          this._unwrap(MilvusClient.prototype, method);
        }
      }
    } catch { /* ignore */ }
  }
}
