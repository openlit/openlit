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
 * Firecrawl JS method name -> Python endpoint identifier.
 *
 * The endpoint string drives the operation name and span name so TS and Python
 * emit aligned telemetry. The JS SDK (`@mendable/firecrawl-js` v1) exposes a
 * single Promise-returning `FirecrawlApp` class, so Python's sync/async pairs
 * collapse onto their camelCase JS equivalents here.
 *
 * Intentionally not wrapped:
 * - `crawlUrlAndWatch` / `batchScrapeUrlsAndWatch` — they call
 *   `asyncCrawlUrl` / `asyncBatchScrapeUrls`, which are already instrumented.
 * - Internal helpers (`prepareHeaders`, `postRequest`, `getRequest`, …).
 * - Newer product surfaces (deepResearch, generateLLMsText) — no Python parity yet.
 */
const FIRECRAWL_METHODS: Array<[string, string]> = [
  ['scrapeUrl', 'firecrawl.scrape_url'],
  ['crawlUrl', 'firecrawl.crawl_url'],
  ['asyncCrawlUrl', 'firecrawl.async_crawl_url'],
  ['mapUrl', 'firecrawl.map_url'],
  ['search', 'firecrawl.search'],
  ['extract', 'firecrawl.extract'],
  ['asyncExtract', 'firecrawl.async_extract'],
  ['getExtractStatus', 'firecrawl.get_extract_status'],
  ['batchScrapeUrls', 'firecrawl.batch_scrape_urls'],
  ['asyncBatchScrapeUrls', 'firecrawl.async_batch_scrape_urls'],
  ['checkCrawlStatus', 'firecrawl.crawl_status'],
  ['checkBatchScrapeStatus', 'firecrawl.get_scrape_status'],
  ['cancelCrawl', 'firecrawl.cancel_crawl'],
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
      // Already wrapped — skip to avoid unwrap/rewrap churn on re-patch.
      if (isWrapped(proto[method])) continue;
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
