import {
  InstrumentationBase,
  InstrumentationModuleDefinition,
  InstrumentationNodeModuleDefinition,
  isWrapped,
} from '@opentelemetry/instrumentation';
import { InstrumentationConfig } from '@opentelemetry/instrumentation';
import { INSTRUMENTATION_PREFIX } from '../../constant';
import PineconeWrapper from './wrapper';

export interface PineconeInstrumentationConfig extends InstrumentationConfig {}

export default class OpenlitPineconeInstrumentation extends InstrumentationBase {
  constructor(config: PineconeInstrumentationConfig = {}) {
    super(`${INSTRUMENTATION_PREFIX}/instrumentation-pinecone`, '1.0.0', config);
  }

  protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[] {
    const module = new InstrumentationNodeModuleDefinition(
      '@pinecone-database/pinecone',
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

  public manualPatch(pinecone: any): void {
    this._patch(pinecone);
  }

  protected _patch(moduleExports: any) {
    try {
      // Patch Index prototype directly
      const IndexClass = moduleExports.Index;
      if (IndexClass?.prototype) {
        const methods: Array<[string, string]> = [
          ['query', 'query'],
          ['upsert', 'upsert'],
          ['deleteOne', 'one'],
          ['deleteMany', 'many'],
          ['update', 'update'],
        ];

        for (const [method, opSuffix] of methods) {
          if (typeof IndexClass.prototype[method] === 'function') {
            if (isWrapped(IndexClass.prototype[method])) {
              this._unwrap(IndexClass.prototype, method);
            }
            if (method === 'query') {
              this._wrap(IndexClass.prototype, method, PineconeWrapper._patchQuery(this.tracer));
            } else if (method === 'upsert') {
              this._wrap(IndexClass.prototype, method, PineconeWrapper._patchUpsert(this.tracer));
            } else if (method === 'update') {
              this._wrap(IndexClass.prototype, method, PineconeWrapper._patchUpdate(this.tracer));
            } else {
              this._wrap(IndexClass.prototype, method, PineconeWrapper._patchDelete(this.tracer, opSuffix));
            }
          }
        }
      }
    } catch (e) {
      console.error('Error in Pinecone _patch method:', e);
    }
  }

  protected _unpatch(moduleExports: any) {
    try {
      const IndexClass = moduleExports.Index;
      if (IndexClass?.prototype) {
        ['query', 'upsert', 'deleteOne', 'deleteMany', 'update'].forEach((method) => {
          if (typeof IndexClass.prototype[method] === 'function') {
            this._unwrap(IndexClass.prototype, method);
          }
        });
      }
    } catch { /* ignore */ }
  }
}
