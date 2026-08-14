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

      // Wrap ONLY Client.prototype.query.
      //
      // We deliberately do NOT wrap Pool.prototype.query. In `pg`, Pool.query()
      // checks out a pooled Client and delegates to that Client's query(), so
      // client-level wrapping already captures pool-routed queries. Wrapping both
      // would emit two spans for a single logical pool query (a Pool span plus a
      // child Client span). This matches the OTel community pg instrumentation,
      // which also instruments only the Client. Result: exactly one span per query.
      const Client = moduleExports.Client;
      if (Client?.prototype && typeof Client.prototype.query === 'function') {
        if (isWrapped(Client.prototype.query)) {
          this._unwrap(Client.prototype, 'query');
        }
        this._clientProto = Client.prototype;
        this._wrap(Client.prototype, 'query', PgWrapper._patchQuery(this.tracer, wrapperConfig));
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
    } catch {
      /* ignore */
    }
  }
}
