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
 * Maps Python-style endpoint identifiers to short operation names.
 * Mirrors `FIRECRAWL_OPERATION_MAP` in the Python reference, plus intentional
 * fixes Python still has as bugs:
 * - `firecrawl.crawl_status` (what Python actually passes for check_crawl_status)
 * - `firecrawl.extract` / `firecrawl.async_extract` (instrumented but unmapped in Python)
 * - `firecrawl.get_extract_status` / `firecrawl.cancel_crawl` with correct op names
 */
const FIRECRAWL_OPERATION_MAP: Record<string, string> = {
  'firecrawl.scrape_url': SemanticConvention.GEN_AI_OPERATION_TYPE_SCRAPE,
  'firecrawl.async_scrape_url': SemanticConvention.GEN_AI_OPERATION_TYPE_SCRAPE,
  'firecrawl.crawl_url': SemanticConvention.GEN_AI_OPERATION_TYPE_CRAWL,
  'firecrawl.async_crawl_url': SemanticConvention.GEN_AI_OPERATION_TYPE_CRAWL,
  'firecrawl.get_crawl_status': SemanticConvention.GEN_AI_OPERATION_TYPE_CRAWL_STATUS,
  'firecrawl.crawl_status': SemanticConvention.GEN_AI_OPERATION_TYPE_CRAWL_STATUS,
  'firecrawl.get_scrape_status': SemanticConvention.GEN_AI_OPERATION_TYPE_SCRAPE_STATUS,
  'firecrawl.async_get_scrape_status': SemanticConvention.GEN_AI_OPERATION_TYPE_SCRAPE_STATUS,
  'firecrawl.map_url': SemanticConvention.GEN_AI_OPERATION_TYPE_MAP,
  'firecrawl.async_map_url': SemanticConvention.GEN_AI_OPERATION_TYPE_MAP,
  'firecrawl.search': SemanticConvention.GEN_AI_OPERATION_TYPE_SEARCH,
  'firecrawl.async_search': SemanticConvention.GEN_AI_OPERATION_TYPE_SEARCH,
  'firecrawl.extract': SemanticConvention.GEN_AI_OPERATION_TYPE_EXTRACT,
  'firecrawl.async_extract': SemanticConvention.GEN_AI_OPERATION_TYPE_EXTRACT,
  'firecrawl.get_extract_status': SemanticConvention.GEN_AI_OPERATION_TYPE_EXTRACT_STATUS,
  'firecrawl.batch_scrape_urls': SemanticConvention.GEN_AI_OPERATION_TYPE_SCRAPE,
  'firecrawl.async_batch_scrape_urls': SemanticConvention.GEN_AI_OPERATION_TYPE_SCRAPE,
  // Python maps cancel → "crawl"; use dedicated cancel op (semcov already defines it).
  'firecrawl.cancel_crawl': SemanticConvention.GEN_AI_OPERATION_TYPE_CANCEL,
  'firecrawl.async_cancel_crawl': SemanticConvention.GEN_AI_OPERATION_TYPE_CANCEL,
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

function getOperationName(endpoint: string): string {
  return FIRECRAWL_OPERATION_MAP[endpoint] ?? SemanticConvention.GEN_AI_OPERATION_TYPE_SCRAPE;
}

/** Primary URL / query / job id for a single-target operation. */
function resolveUrl(args: any[]): string {
  if (args.length > 0 && typeof args[0] === 'string') {
    return args[0];
  }
  if (args[0] && typeof args[0] === 'object' && typeof args[0].url === 'string') {
    return args[0].url;
  }
  return 'unknown';
}

/**
 * URL list for batch / extract operations.
 * Supports positional `string[]` and `{ urls: string[] }` option bags.
 */
function resolveUrls(args: any[]): string[] {
  if (Array.isArray(args[0])) {
    return args[0].map((url: unknown) => String(url));
  }
  if (args[0] && typeof args[0] === 'object' && Array.isArray(args[0].urls)) {
    return args[0].urls.map((url: unknown) => String(url));
  }
  // extract / asyncExtract may pass urls as the first arg; also accept second-arg urls
  if (args[1] && typeof args[1] === 'object' && Array.isArray(args[1].urls)) {
    return args[1].urls.map((url: unknown) => String(url));
  }
  return [];
}

/**
 * Builds `{operation} {target}` span names matching the Python reference.
 * Multi-URL ops (batch scrape, extract) list a bounded sample of URLs.
 */
function getSpanName(operation: string, url: string, urls: string[]): string {
  if (urls.length > 0) {
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
   * Wraps a Promise-returning Firecrawl method into a CLIENT span named
   * `{operation} {target}`. `endpoint` is the Python-style endpoint id that
   * drives the operation name.
   */
  static _patchOperation(tracer: Tracer, endpoint: string, version?: string): any {
    const sdkVersion = version || 'unknown';

    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        if (isTracingSuppressed(context.active())) {
          return originalMethod.apply(this, args);
        }

        const operation = getOperationName(endpoint);
        const urls = resolveUrls(args);
        const url = urls.length > 0 ? urls[0] : resolveUrl(args);
        const isMultiUrl = urls.length > 0;
        const spanName = getSpanName(operation, url, urls);

        const span = tracer.startSpan(spanName, {
          kind: SpanKind.CLIENT,
          attributes: {
            [SemanticConvention.GEN_AI_OPERATION]: operation,
            [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: FirecrawlWrapper.aiSystem,
          },
        });
        const startTime = Date.now();

        FirecrawlWrapper._setSpanAttributes(span, operation, sdkVersion, url, urls, isMultiUrl);
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

  /** Framework + request attributes (Python `set_span_attributes` parity). */
  static _setSpanAttributes(
    span: Span,
    operation: string,
    sdkVersion: string,
    url: string,
    urls: string[],
    isMultiUrl: boolean
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

    if (isMultiUrl) {
      span.setAttribute(SemanticConvention.GEN_AI_CRAWL_URL_COUNT, urls.length);
      span.setAttribute(SemanticConvention.GEN_AI_AGENT_BROWSE_URL, urls[0]);
    } else if (url && url !== 'unknown') {
      span.setAttribute(SemanticConvention.GEN_AI_AGENT_BROWSE_URL, url);
    }
  }

  /** Response business-intelligence attributes (Python `process_response` parity). */
  static _processResponse(span: Span, response: any, url: string): void {
    if (response === undefined || response === null) return;

    if (Array.isArray(response)) {
      span.setAttribute(SemanticConvention.GEN_AI_CRAWL_URL_COUNT, response.length);
      span.setAttribute(SemanticConvention.GEN_AI_CRAWL_RESULT_SUCCESS, true);

      const successCount = response.filter(
        (item: any) => item && typeof item === 'object' && (item.success ?? true)
      ).length;
      span.setAttribute(SemanticConvention.GEN_AI_CRAWL_RESULT_SUCCESS_COUNT, successCount);
      span.setAttribute(
        SemanticConvention.GEN_AI_CRAWL_RESULT_SUCCESS_RATE,
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

    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_TYPE, typeof response);
  }

  private static _processSingleResponse(span: Span, response: any, url: string): void {
    const success = response.success ?? true;
    span.setAttribute(SemanticConvention.GEN_AI_CRAWL_RESULT_SUCCESS, success);

    if (response.warning) {
      span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_WARNING, String(response.warning));
    }
    if (response.error) {
      span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_ERROR, String(response.error));
    }

    const metadata = response.metadata;
    if (metadata && typeof metadata === 'object') {
      if (metadata.title) {
        span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_TITLE, String(metadata.title));
      }
      if (metadata.description) {
        span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_DESCRIPTION, String(metadata.description));
      }
      if (metadata.statusCode !== undefined) {
        span.setAttribute(SemanticConvention.GEN_AI_CRAWL_RESULT_STATUS_CODE, metadata.statusCode);
      }
      if (metadata.error) {
        span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_ERROR, String(metadata.error));
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
      span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_HAS_SCREENSHOT, true);
    }

    if (response.completed !== undefined && response.completed !== null) {
      span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_PROGRESS_COMPLETED, response.completed);
    }
    if (response.total !== undefined && response.total !== null) {
      span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_PROGRESS_TOTAL, response.total);
      if (
        response.completed !== undefined &&
        response.completed !== null &&
        response.total > 0
      ) {
        span.setAttribute(
          SemanticConvention.GEN_AI_RESPONSE_COMPLETION_RATE,
          (response.completed / response.total) * 100
        );
      }
    }

    if (response.creditsUsed !== undefined && response.creditsUsed !== null) {
      span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_CREDITS_USED, response.creditsUsed);
    }

    if (response.status) {
      span.setAttribute(SemanticConvention.GEN_AI_MONITOR_TASK_STATUS, String(response.status));
    }

    if (response.id) {
      span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_JOB_ID, String(response.id));
    }
    if (response.expiresAt) {
      span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_EXPIRES_AT, String(response.expiresAt));
    }

    if (Array.isArray(response.data)) {
      span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_DATA_COUNT, response.data.length);

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
        span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_TOTAL_LINKS_COUNT, totalLinks);
      }
      if (totalContentLength > 0) {
        span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_TOTAL_CONTENT_LENGTH, totalContentLength);
      }
      if (response.data.length > 0) {
        span.setAttribute(
          SemanticConvention.GEN_AI_RESPONSE_SUCCESS_RATE,
          successCount / response.data.length
        );
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
   * Firecrawl-specific error attributes. `OpenLitHelper.handleException` still
   * records the exception, ERROR status, and `error.type`.
   */
  static _handleError(span: Span, error: any): void {
    span.setAttribute(SemanticConvention.ERROR_MESSAGE, String(error?.message ?? error));

    const httpResponse = error?.response;
    if (httpResponse && typeof httpResponse === 'object') {
      if (httpResponse.status_code !== undefined) {
        span.setAttribute(SemanticConvention.HTTP_STATUS_CODE, httpResponse.status_code);
      } else if (httpResponse.status !== undefined) {
        span.setAttribute(SemanticConvention.HTTP_STATUS_CODE, httpResponse.status);
      }
      if (typeof httpResponse.text === 'string') {
        span.setAttribute(SemanticConvention.ERROR_RESPONSE_TEXT, truncateContent(httpResponse.text));
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
    span.setAttribute(SemanticConvention.ERROR_CATEGORY, category);
  }
}

export default FirecrawlWrapper;
