import {
  InstrumentationBase,
  InstrumentationModuleDefinition,
  InstrumentationNodeModuleDefinition,
  InstrumentationNodeModuleFile,
  isWrapped,
} from '@opentelemetry/instrumentation';
import { InstrumentationConfig } from '@opentelemetry/instrumentation';
import { diag } from '@opentelemetry/api';
import { INSTRUMENTATION_PREFIX } from '../../constant';
import Mem0Wrapper from './wrapper';

export interface Mem0InstrumentationConfig extends InstrumentationConfig {}

/**
 * mem0 method name -> span name. Span names reuse the Python endpoint strings
 * (snake_case `get_all` / `delete_all`) so TS and Python emit identical span names,
 * even though the JS methods are camelCase (`getAll` / `deleteAll`).
 */
const MEM0_METHODS: Array<[string, string]> = [
  ['add', 'memory add'],
  ['search', 'memory search'],
  ['get', 'memory get'],
  ['getAll', 'memory get_all'],
  ['update', 'memory update'],
  ['delete', 'memory delete'],
  ['deleteAll', 'memory delete_all'],
  ['history', 'memory history'],
  ['reset', 'memory reset'],
];

export default class OpenlitMem0Instrumentation extends InstrumentationBase {
  constructor(config: Mem0InstrumentationConfig = {}) {
    super(`${INSTRUMENTATION_PREFIX}/instrumentation-mem0`, '1.0.0', config);
  }

  protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[] {
    // mem0ai ships two clients at two specifiers:
    //   - `mem0ai`       -> hosted MemoryClient (the package entry, patched below)
    //   - `mem0ai/oss`   -> self-hosted Memory (an internal file)
    // require-in-the-middle reaches internal files via the `files` array, so the OSS
    // entry is registered as InstrumentationNodeModuleFile(s) on the main definition.
    // A few candidate paths are listed to stay robust across build layouts.
    const ossFiles = ['mem0ai/dist/oss/index.js', 'mem0ai/dist/oss/index.cjs', 'mem0ai/oss/index.js'].map(
      (filePath) =>
        new InstrumentationNodeModuleFile(
          filePath,
          ['>=0.1.32'],
          (moduleExports: any, moduleVersion?: string) => {
            this._patchOss(moduleExports, moduleVersion);
            return moduleExports;
          },
          (moduleExports: any) => {
            if (moduleExports !== undefined) this._unpatchOss(moduleExports);
          }
        )
    );

    const module = new InstrumentationNodeModuleDefinition(
      'mem0ai',
      ['>=0.1.32'],
      (moduleExports: any, moduleVersion?: string) => {
        this._patch(moduleExports, moduleVersion);
        return moduleExports;
      },
      (moduleExports: any) => {
        if (moduleExports !== undefined) this._unpatch(moduleExports);
      },
      ossFiles
    );

    return [module];
  }

  public manualPatch(mem0: any): void {
    // Manual entry point (openlit.init({ instrumentations: { mem0 } })). The caller may
    // pass either the hosted module/class or the OSS one, so try both resolvers — the
    // isWrapped guard in _patchClass keeps it idempotent.
    this._patch(mem0);
    this._patchOss(mem0);
  }

  /** Patch the hosted MemoryClient (default export of `mem0ai`). */
  protected _patch(moduleExports: any, moduleVersion?: string) {
    const ClientClass = moduleExports?.MemoryClient ?? moduleExports?.default ?? moduleExports;
    this._patchClass(ClientClass, moduleVersion);
  }

  /** Patch the self-hosted Memory class (`mem0ai/oss`). */
  protected _patchOss(moduleExports: any, moduleVersion?: string) {
    const MemoryClass = moduleExports?.Memory ?? moduleExports?.default ?? moduleExports;
    this._patchClass(MemoryClass, moduleVersion);
  }

  private _patchClass(target: any, moduleVersion?: string) {
    try {
      const proto = target?.prototype;
      if (!proto) return;

      for (const [method, spanName] of MEM0_METHODS) {
        if (typeof proto[method] !== 'function') continue;
        if (isWrapped(proto[method])) {
          this._unwrap(proto, method);
        }
        this._wrap(proto, method, Mem0Wrapper._patchMemoryOperation(this.tracer, spanName, moduleVersion));
      }
    } catch (e) {
      diag.error('mem0 instrumentation: error in _patch method', e);
    }
  }

  protected _unpatch(moduleExports: any) {
    const ClientClass = moduleExports?.MemoryClient ?? moduleExports?.default ?? moduleExports;
    this._unpatchClass(ClientClass);
  }

  protected _unpatchOss(moduleExports: any) {
    const MemoryClass = moduleExports?.Memory ?? moduleExports?.default ?? moduleExports;
    this._unpatchClass(MemoryClass);
  }

  private _unpatchClass(target: any) {
    try {
      const proto = target?.prototype;
      if (!proto) return;
      for (const [method] of MEM0_METHODS) {
        if (typeof proto[method] === 'function' && isWrapped(proto[method])) {
          this._unwrap(proto, method);
        }
      }
    } catch {
      /* ignore */
    }
  }
}
