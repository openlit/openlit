import { Span, SpanKind, SpanStatusCode, Tracer, context, trace } from '@opentelemetry/api';
import { isTracingSuppressed } from '@opentelemetry/core';
import { ATTR_SERVICE_NAME, ATTR_TELEMETRY_SDK_NAME } from '@opentelemetry/semantic-conventions';
import OpenlitConfig from '../../config';
import { SDK_NAME } from '../../constant';
import OpenLitHelper, { applyCustomSpanAttributes } from '../../helpers';
import SemanticConvention from '../../semantic-convention';

const SERVER_ADDRESS = 'api.firecrawl.dev';
const SERVER_PORT = 443;

/**
 * Maps the Python endpoint identifiers to a short operation name. Mirrors
 * FIRECRAWL_OPERATION_MAP in the Python reference (sdk/python/.../firecrawl/utils.py),
 * with the extra `firecrawl.crawl_status` key that the Python instrumentor actually
 * passes for `check_crawl_status` so the status check resolves to `crawl_status`
 * rather than falling back to the `scrape` default.
 */
const FIRECRAWL_OPERATION_MAP: Record<string, string> = {
  'firecrawl.scrape_url': SemanticConvention.GEN_AI_OPERATION_TYPE_SCRAPE,
  'firecrawl.async_scrape_url': SemanticConvention.GEN_AI_OPERATION_TYPE_SCRAPE,
  'firecrawl.crawl_url': SemanticConvention.GEN_AI_OPERATION_TYPE_CRAWL,
  'firecrawl.async_crawl_url': SemanticConvention.GEN_AI_OPERATION_TYPE_CRAWL,
  'firecrawl.get_crawl_status': SemanticConvention.GEN_AI_OPERATION_TYPE_CRAWL_STATUS,
  'firecrawl.crawl_status': SemanticConvention.GEN_AI_OPERATION_TYPE_CRAWL_STATUS,
  'firecrawl.get_scrape_status': SemanticConvention.GEN_AI_OPERATION_TYPE_SCRAPE_STATUS,
  'firecrawl.map_url': SemanticConvention.GEN_AI_OPERATION_TYPE_MAP,
  'firecrawl.async_map_url': SemanticConvention.GEN_AI_OPERATION_TYPE_MAP,
  'firecrawl.search': SemanticConvention.GEN_AI_OPERATION_TYPE_SEARCH,
  'firecrawl.async_search': SemanticConvention.GEN_AI_OPERATION_TYPE_SEARCH,
  'firecrawl.batch_scrape_urls': SemanticConvention.GEN_AI_OPERATION_TYPE_SCRAPE,
  'firecrawl.async_batch_scrape_urls': SemanticConvention.GEN_AI_OPERATION_TYPE_SCRAPE,
};

function truncateContent(content: string, maxLength?: number): string {
  const limit = maxLength ?? OpenlitConfig.maxContentLength;
  if (typeof limit === 'number' && limit > 0 && content.length > limit) {
    return content.slice(0, limit);
  }
  return content;
}

function formatContent(content: unknown, maxLength: number): string {
  if (content === undefined || content === null) return '';
  const str = String(content);
  return str.length > maxLength ? `${str.slice(0, maxLength)}...` : str;
}

/**
 * Resolves the operation name for an endpoint. Defaults to `scrape`, matching the
 * Python `get_operation_name` fallback.
 */
function getOperationName(endpoint: string): string {
  return FIRECRAWL_OPERATION_MAP[endpoint] ?? SemanticConvention.GEN_AI_OPERATION_TYPE_SCRAPE;
}

/** Primary URL for a single-target operation (first positional arg or `url` option). */
function resolveUrl(args: any[]): string {
  if (args.length > 0 && typeof args[0] === 'string') {
    return args[0];
  }
  if (args[0] && typeof args[0] === 'object' && typeof args[0].url === 'string') {
    return args[0].url;
  }
  return 'unknown';
}

/** URL list for batch operations (first positional array or `urls` option). */
function resolveUrls(args: any[]): string[] {
  if (Array.isArray(args[0])) {
    return args[0].map((url: unknown) => String(url));
  }
  if (args[0] && typeof args[0] === 'object' && Array.isArray(args[0].urls)) {
    return args[0].urls.map((url: unknown) => String(url));
  }
  return [];
}

/**
 * Builds the span name in the `{operation} {target}` shape used by the Python
 * reference. Batch operations list a bounded sample of URLs.
 */
function getSpanName(operation: string, endpoint: string, url: string, urls: string[]): string {
  if (endpoint.includes('batch') && urls.length > 0) {
    if (urls.length <= 3) {
      const urlsStr = urls.join(', ');
      if (urlsStr.length <= 80) {
        return `${operation} [${urlsStr}]`;
      }
    }
    const sample = urls.slice(0, 2);
    const remaining = urls.length - 2;
    const urlsSample = remaining > 0 ? `${sample.join(', ')} +${remaining} more` : sample.join(', ');
    return `${operation} [${urlsSample}]`;
  }
  return `${operation} ${url}`;
}

class FirecrawlWrapper {
  static aiSystem = SemanticConvention.GEN_AI_SYSTEM_FIRECRAWL;

  /**
   * Wraps a Promise-returning Firecrawl method (`scrapeUrl`, `crawlUrl`, `mapUrl`,
   * `search`, `extract`, `batchScrapeUrls`, `checkCrawlStatus`, ...) into a single
   * CLIENT span named `{operation} {target}`. `endpoint` is the Python endpoint
   * identifier that drives the operation name, matching the Python reference
   * (sdk/python/src/openlit/instrumentation/firecrawl).
   */
  static _patchOperation(tracer: Tracer, endpoint: string, version?: string): any {
    const sdkVersion = version || 'unknown';

    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        if (isTracingSuppressed(context.active())) {
          return originalMethod.apply(this, args);
        }

        const operation = getOperationName(endpoint);
        const url = resolveUrl(args);
        const urls = resolveUrls(args);
        const isBatch = endpoint.includes('batch');
        const spanName = getSpanName(operation, endpoint, url, urls);

        const span = tracer.startSpan(spanName, {
          kind: SpanKind.CLIENT,
          attributes: {
            [SemanticConvention.GEN_AI_OPERATION]: operation,
            [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: FirecrawlWrapper.aiSystem,
          },
        });
        const startTime = Date.now();

        FirecrawlWrapper._setSpanAttributes(span, operation, sdkVersion, url, urls, isBatch);
        applyCustomSpanAttributes(span);

        return context.with(trace.setSpan(context.active(), span), async () => {
          try {
            const response = await originalMethod.apply(this, args);
            span.setAttribute(
              SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION,
              (Date.now() - startTime) / 1000
            );
            FirecrawlWrapper._processResponse(span, response, url);
            span.setStatus({ code: SpanStatusCode.OK });
            return response;
          } catch (e: any) {
            span.setAttribute(
              SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION,
              (Date.now() - startTime) / 1000
            );
            FirecrawlWrapper._handleError(span, e);
            OpenLitHelper.handleException(span, e);
            throw e;
          } finally {
            span.end();
          }
        });
      };
    };
  }

  /** Sets the framework + request attributes, mirroring Python `set_span_attributes`. */
  static _setSpanAttributes(
    span: Span,
    operation: string,
    sdkVersion: string,
    url: string,
    urls: string[],
    isBatch: boolean
  ): void {
    span.setAttribute(ATTR_TELEMETRY_SDK_NAME, SDK_NAME);
    span.setAttribute(SemanticConvention.GEN_AI_PROVIDER_NAME, FirecrawlWrapper.aiSystem);
    span.setAttribute(SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL, FirecrawlWrapper.aiSystem);
    span.setAttribute(SemanticConvention.GEN_AI_OPERATION, operation);
    span.setAttribute(SemanticConvention.ATTR_DEPLOYMENT_ENVIRONMENT, OpenlitConfig.environment || '');
    span.setAttribute(ATTR_SERVICE_NAME, OpenlitConfig.applicationName || '');
    span.setAttribute(SemanticConvention.GEN_AI_SDK_VERSION, sdkVersion);
    span.setAttribute(SemanticConvention.SERVER_ADDRESS, SERVER_ADDRESS);
    span.setAttribute(SemanticConvention.SERVER_PORT, SERVER_PORT);

    span.setAttribute(
      SemanticConvention.GEN_AI_AGENT_TYPE,
      SemanticConvention.GEN_AI_AGENT_TYPE_BROWSER
    );

    if (isBatch && urls.length > 0) {
      span.setAttribute(SemanticConvention.GEN_AI_CRAWL_URL_COUNT, urls.length);
      span.setAttribute(SemanticConvention.GEN_AI_AGENT_BROWSE_URL, urls[0]);
    } else if (url && url !== 'unknown') {
      span.setAttribute(SemanticConvention.GEN_AI_AGENT_BROWSE_URL, url);
    }
  }

  /** Extracts business-intelligence attributes from the response, matching Python. */
  static _processResponse(span: Span, response: any, url: string): void {
    if (response === undefined || response === null) return;

    if (Array.isArray(response)) {
      span.setAttribute(SemanticConvention.GEN_AI_CRAWL_URL_COUNT, response.length);
      span.setAttribute(SemanticConvention.GEN_AI_CRAWL_RESULT_SUCCESS, true);

      const successCount = response.filter(
        (item: any) => item && typeof item === 'object' && (item.success ?? true)
      ).length;
      span.setAttribute('gen_ai.crawl.result.success_count', successCount);
      span.setAttribute(
        'gen_ai.crawl.result.success_rate',
        response.length ? successCount / response.length : 0
      );

      if (OpenlitConfig.captureMessageContent) {
        span.setAttribute(
          SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
          `Processed ${response.length} URLs, ${successCount} successful`
        );
      }
      return;
    }

    if (typeof response === 'object') {
      FirecrawlWrapper._processSingleResponse(span, response, url);
      return;
    }

    span.setAttribute('gen_ai.response.type', typeof response);
  }

  private static _processSingleResponse(span: Span, response: any, url: string): void {
    const success = response.success ?? true;
    span.setAttribute(SemanticConvention.GEN_AI_CRAWL_RESULT_SUCCESS, success);

    if (response.warning) {
      span.setAttribute('gen_ai.response.warning', String(response.warning));
    }
    if (response.error) {
      span.setAttribute('gen_ai.response.error', String(response.error));
    }

    const metadata = response.metadata;
    if (metadata && typeof metadata === 'object') {
      if (metadata.title) {
        span.setAttribute('gen_ai.response.title', String(metadata.title));
      }
      if (metadata.description) {
        span.setAttribute('gen_ai.response.description', String(metadata.description));
      }
      if (metadata.statusCode !== undefined) {
        span.setAttribute(SemanticConvention.GEN_AI_CRAWL_RESULT_STATUS_CODE, metadata.statusCode);
      }
      if (metadata.error) {
        span.setAttribute('gen_ai.response.error', String(metadata.error));
      }
    }

    if (response.markdown) {
      span.setAttribute(
        SemanticConvention.GEN_AI_CRAWL_RESULT_MARKDOWN_LENGTH,
        String(response.markdown).length
      );
    } else if (response.html) {
      span.setAttribute(
        SemanticConvention.GEN_AI_CRAWL_RESULT_HTML_LENGTH,
        String(response.html).length
      );
    } else if (response.rawHtml) {
      span.setAttribute(
        SemanticConvention.GEN_AI_CRAWL_RESULT_HTML_LENGTH,
        String(response.rawHtml).length
      );
    }

    if (Array.isArray(response.links)) {
      span.setAttribute(SemanticConvention.GEN_AI_CRAWL_RESULT_LINKS_COUNT, response.links.length);
    }

    if (response.screenshot) {
      span.setAttribute('gen_ai.response.has_screenshot', true);
    }

    if (response.completed !== undefined && response.completed !== null) {
      span.setAttribute('gen_ai.response.progress_completed', response.completed);
    }
    if (response.total !== undefined && response.total !== null) {
      span.setAttribute('gen_ai.response.progress_total', response.total);
      if (
        response.completed !== undefined &&
        response.completed !== null &&
        response.total > 0
      ) {
        span.setAttribute(
          'gen_ai.response.completion_rate',
          (response.completed / response.total) * 100
        );
      }
    }

    if (response.creditsUsed !== undefined && response.creditsUsed !== null) {
      span.setAttribute('gen_ai.response.credits_used', response.creditsUsed);
    }

    if (response.status) {
      span.setAttribute(SemanticConvention.GEN_AI_MONITOR_TASK_STATUS, String(response.status));
    }

    if (response.id) {
      span.setAttribute('gen_ai.response.job_id', String(response.id));
    }
    if (response.expiresAt) {
      span.setAttribute('gen_ai.response.expires_at', String(response.expiresAt));
    }

    if (Array.isArray(response.data)) {
      span.setAttribute('gen_ai.response.data_count', response.data.length);

      let totalLinks = 0;
      let totalContentLength = 0;
      let successCount = 0;

      for (const item of response.data) {
        if (!item || typeof item !== 'object') continue;
        if (item.success ?? true) successCount += 1;
        if (Array.isArray(item.links)) totalLinks += item.links.length;
        if (item.markdown) {
          totalContentLength += String(item.markdown).length;
        } else if (item.html) {
          totalContentLength += String(item.html).length;
        }
      }

      if (totalLinks > 0) {
        span.setAttribute('gen_ai.response.total_links_count', totalLinks);
      }
      if (totalContentLength > 0) {
        span.setAttribute('gen_ai.response.total_content_length', totalContentLength);
      }
      if (response.data.length > 0) {
        span.setAttribute('gen_ai.response.success_rate', successCount / response.data.length);
      }
    }

    if (OpenlitConfig.captureMessageContent) {
      FirecrawlWrapper._captureContentSummary(span, response, url);
    }
  }

  private static _captureContentSummary(span: Span, response: any, url: string): void {
    span.setAttribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, url);

    if (response.markdown) {
      span.setAttribute(
        SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
        formatContent(response.markdown, 500)
      );
    } else if (response.html) {
      span.setAttribute(
        SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
        formatContent(response.html, 300)
      );
    } else if (response.text) {
      span.setAttribute(
        SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
        formatContent(response.text, 500)
      );
    } else {
      const title = response.metadata?.title;
      span.setAttribute(
        SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
        title ? `Scraped: ${title}` : 'Content scraped successfully'
      );
    }
  }

  /**
   * Sets Firecrawl-specific error attributes (message, category, HTTP status).
   * `OpenLitHelper.handleException` still records the exception, ERROR status and
   * `error.type` on the caller side.
   */
  static _handleError(span: Span, error: any): void {
    span.setAttribute('error.message', String(error?.message ?? error));

    const httpResponse = error?.response;
    if (httpResponse && typeof httpResponse === 'object') {
      if (httpResponse.status_code !== undefined) {
        span.setAttribute('http.status_code', httpResponse.status_code);
      } else if (httpResponse.status !== undefined) {
        span.setAttribute('http.status_code', httpResponse.status);
      }
      if (typeof httpResponse.text === 'string') {
        span.setAttribute('error.response_text', truncateContent(httpResponse.text));
      }
    }

    const message = String(error?.message ?? error).toLowerCase();
    let category = 'unknown';
    if (message.includes('rate limit')) {
      category = 'rate_limit';
    } else if (message.includes('api key') || message.includes('authentication')) {
      category = 'authentication';
    } else if (message.includes('timeout')) {
      category = 'timeout';
    } else if (message.includes('not found')) {
      category = 'not_found';
    }
    span.setAttribute('error.category', category);
  }
}

export default FirecrawlWrapper;
