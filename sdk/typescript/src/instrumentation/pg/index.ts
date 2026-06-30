import {
  InstrumentationBase,
  InstrumentationModuleDefinition,
  InstrumentationNodeModuleDefinition,
  InstrumentationConfig,
  isWrapped,
} from '@opentelemetry/instrumentation';
import { diag } from '@opentelemetry/api';
import { INSTRUMENTATION_PREFIX } from '../../constant';
import PgWrapper from './wrapper';

/**
 * Configuration for the PostgreSQL (`pg`) instrumentation.
 *
 * `captureDbParameters` mirrors the Python psycopg instrumentor's
 * `capture_db_parameters` flag. It is OFF by default because query parameters
 * may contain PII / secrets. Enable only when you are certain parameters are safe.
 */
export interface PgInstrumentationConfig extends InstrumentationConfig {
  captureDbParameters?: boolean;
}

export default class OpenlitPgInstrumentation extends InstrumentationBase {
  private _clientProto: any = null;
  private _poolProto: any = null;

  constructor(config: PgInstrumentationConfig = {}) {
    super(`${INSTRUMENTATION_PREFIX}/instrumentation-pg`, '1.0.0', config);
  }

  private get captureDbParameters(): boolean {
    return Boolean((this.getConfig() as PgInstrumentationConfig)?.captureDbParameters);
  }

  protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[] {
    const module = new InstrumentationNodeModuleDefinition(
      'pg',
      ['>=7.0.0', '>=8.0.0'],
      (moduleExports, moduleVersion) => {
        this._patch(moduleExports, moduleVersion);
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

  public manualPatch(pg: any): void {
    this._patch(pg);
  }

  protected _patch(moduleExports: any, moduleVersion?: string) {
    try {
      if (!moduleExports) return;
      const sdkVersion = moduleVersion ? String(moduleVersion) : undefined;
      const wrapperConfig = { captureDbParameters: this.captureDbParameters, sdkVersion };

      // Wrap Client.prototype.query.
      const Client = moduleExports.Client;
      if (Client?.prototype && typeof Client.prototype.query === 'function') {
        if (isWrapped(Client.prototype.query)) {
          this._unwrap(Client.prototype, 'query');
        }
        this._clientProto = Client.prototype;
        this._wrap(Client.prototype, 'query', PgWrapper._patchQuery(this.tracer, wrapperConfig));
      }

      // Wrap Pool.prototype.query.
      //
      // `pg`'s Pool.query() delegates to an underlying Client.query(), so wrapping
      // both would double-count. We still wrap Pool.query for parity (it captures
      // pool-routed queries even if the Client constructor was swapped), and the
      // single-span guard inside the wrapper relies on OTel context: the inner
      // Client.query runs inside the Pool span's context as a child. To avoid an
      // extra child span, prefer wrapping Client only when both share the same
      // query implementation.
      const Pool = moduleExports.Pool;
      if (
        Pool?.prototype &&
        typeof Pool.prototype.query === 'function' &&
        Pool.prototype.query !== Client?.prototype?.query
      ) {
        if (isWrapped(Pool.prototype.query)) {
          this._unwrap(Pool.prototype, 'query');
        }
        this._poolProto = Pool.prototype;
        this._wrap(Pool.prototype, 'query', PgWrapper._patchQuery(this.tracer, wrapperConfig));
      }
    } catch (e) {
      diag.error('pg instrumentation: error in _patch method', e);
    }
  }

  protected _unpatch(moduleExports?: any) {
    try {
      if (moduleExports?.Client?.prototype && isWrapped(moduleExports.Client.prototype.query)) {
        this._unwrap(moduleExports.Client.prototype, 'query');
      } else if (this._clientProto && isWrapped(this._clientProto.query)) {
        this._unwrap(this._clientProto, 'query');
      }
      if (moduleExports?.Pool?.prototype && isWrapped(moduleExports.Pool.prototype.query)) {
        this._unwrap(moduleExports.Pool.prototype, 'query');
      } else if (this._poolProto && isWrapped(this._poolProto.query)) {
        this._unwrap(this._poolProto, 'query');
      }
    } catch {
      /* ignore */
    }
  }
}
