import {
  InstrumentationBase,
  InstrumentationModuleDefinition,
  InstrumentationNodeModuleDefinition,
  isWrapped,
} from '@opentelemetry/instrumentation';
import { InstrumentationConfig } from '@opentelemetry/instrumentation';
import { diag } from '@opentelemetry/api';
import { INSTRUMENTATION_PREFIX } from '../../constant';
import FirecrawlWrapper from './wrapper';

export interface FirecrawlInstrumentationConfig extends InstrumentationConfig {}

/**
 * Firecrawl JS method name -> Python endpoint identifier. The endpoint string drives
 * the operation name and span name so TS and Python emit identical telemetry. The JS
 * SDK exposes a single Promise-returning class (`FirecrawlApp`), so the sync and async
 * Python methods collapse onto their camelCase JS equivalents here.
 */
const FIRECRAWL_METHODS: Array<[string, string]> = [
  ['scrapeUrl', 'firecrawl.scrape_url'],
  ['crawlUrl', 'firecrawl.crawl_url'],
  ['asyncCrawlUrl', 'firecrawl.async_crawl_url'],
  ['mapUrl', 'firecrawl.map_url'],
  ['search', 'firecrawl.search'],
  ['extract', 'firecrawl.extract'],
  ['batchScrapeUrls', 'firecrawl.batch_scrape_urls'],
  ['asyncBatchScrapeUrls', 'firecrawl.async_batch_scrape_urls'],
  ['checkCrawlStatus', 'firecrawl.crawl_status'],
];

export default class OpenlitFirecrawlInstrumentation extends InstrumentationBase {
  constructor(config: FirecrawlInstrumentationConfig = {}) {
    super(`${INSTRUMENTATION_PREFIX}/instrumentation-firecrawl`, '1.0.0', config);
  }

  protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[] {
    const module = new InstrumentationNodeModuleDefinition(
      '@mendable/firecrawl-js',
      ['>=1.0.0 <4'],
      (moduleExports: any, moduleVersion?: string) => {
        this._patch(moduleExports, moduleVersion);
        return moduleExports;
      },
      (moduleExports: any) => {
        if (moduleExports !== undefined) this._unpatch(moduleExports);
      }
    );

    return [module];
  }

  public manualPatch(firecrawl: any): void {
    this._patch(firecrawl);
  }

  protected _patch(moduleExports: any, moduleVersion?: string) {
    try {
      const sdkVersion = moduleVersion ? String(moduleVersion) : undefined;
      // The package has shipped the client under a few export names across versions
      // (`FirecrawlApp` default, plus `AsyncFirecrawlApp` / `Firecrawl`). Patch every
      // class it exposes; the isWrapped guard keeps this idempotent.
      for (const target of this._resolveClasses(moduleExports)) {
        this._patchClass(target, sdkVersion);
      }
    } catch (e) {
      diag.error('firecrawl instrumentation: error in _patch method', e);
    }
  }

  private _resolveClasses(moduleExports: any): any[] {
    const candidates = [
      moduleExports?.FirecrawlApp,
      moduleExports?.AsyncFirecrawlApp,
      moduleExports?.Firecrawl,
      moduleExports?.default,
      moduleExports,
    ];
    const seen = new Set<any>();
    return candidates.filter((cls) => {
      if (typeof cls !== 'function' || seen.has(cls)) return false;
      seen.add(cls);
      return true;
    });
  }

  private _patchClass(target: any, sdkVersion?: string) {
    const proto = target?.prototype;
    if (!proto) return;

    for (const [method, endpoint] of FIRECRAWL_METHODS) {
      if (typeof proto[method] !== 'function') continue;
      if (isWrapped(proto[method])) {
        this._unwrap(proto, method);
      }
      this._wrap(proto, method, FirecrawlWrapper._patchOperation(this.tracer, endpoint, sdkVersion));
    }
  }

  protected _unpatch(moduleExports: any) {
    try {
      for (const target of this._resolveClasses(moduleExports)) {
        const proto = target?.prototype;
        if (!proto) continue;
        for (const [method] of FIRECRAWL_METHODS) {
          if (typeof proto[method] === 'function' && isWrapped(proto[method])) {
            this._unwrap(proto, method);
          }
        }
      }
    } catch {
      /* ignore */
    }
  }
}
