import { SpanKind } from '@opentelemetry/api';
import { isTracingSuppressed } from '@opentelemetry/core';
import { ATTR_SERVICE_NAME, ATTR_TELEMETRY_SDK_NAME } from '@opentelemetry/semantic-conventions';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import SemanticConvention from '../../semantic-convention';
import FirecrawlWrapper from '../firecrawl/wrapper';
import FirecrawlInstrumentation from '../firecrawl';

jest.mock('../../config');
jest.mock('../../helpers', () => ({
  __esModule: true,
  default: {
    handleException: jest.fn(),
  },
  applyCustomSpanAttributes: jest.fn(),
}));
jest.mock('@opentelemetry/core', () => ({
  isTracingSuppressed: jest.fn().mockReturnValue(false),
}));

describe('firecrawl wrapper', () => {
  let mockSpan: any;
  let mockTracer: any;

  beforeEach(() => {
    mockSpan = {
      setAttribute: jest.fn(),
      setStatus: jest.fn(),
      end: jest.fn(),
      recordException: jest.fn(),
    };
    mockTracer = { startSpan: jest.fn(() => mockSpan) };

    (OpenlitConfig as any).environment = 'openlit-testing';
    (OpenlitConfig as any).applicationName = 'openlit-test';
    (OpenlitConfig as any).captureMessageContent = true;
    (OpenlitConfig as any).maxContentLength = null;
    (isTracingSuppressed as jest.Mock).mockReturnValue(false);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  function attrs(): Record<string, any> {
    return Object.fromEntries((mockSpan.setAttribute as jest.Mock).mock.calls);
  }

  it('wraps scrapeUrl into a scrape span with firecrawl metadata', async () => {
    class StubFirecrawlApp {
      async scrapeUrl(_url: string) {
        return {
          success: true,
          markdown: '# Example Domain\nThis is example content.',
          links: ['https://example.com/a', 'https://example.com/b'],
          metadata: { title: 'Example', statusCode: 200 },
        };
      }
    }

    const app = new StubFirecrawlApp();
    const wrapped = FirecrawlWrapper._patchOperation(mockTracer, 'firecrawl.scrape_url', '1.29.3')(
      StubFirecrawlApp.prototype.scrapeUrl
    );
    const result = await wrapped.call(app, 'https://example.com');

    expect(result.success).toBe(true);
    expect(mockTracer.startSpan).toHaveBeenCalledWith('scrape https://example.com', {
      kind: SpanKind.CLIENT,
      attributes: {
        [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_SCRAPE,
        [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: SemanticConvention.GEN_AI_SYSTEM_FIRECRAWL,
      },
    });

    const a = attrs();
    expect(a[ATTR_TELEMETRY_SDK_NAME]).toBe('openlit');
    expect(a[ATTR_SERVICE_NAME]).toBe('openlit-test');
    expect(a[SemanticConvention.ATTR_DEPLOYMENT_ENVIRONMENT]).toBe('openlit-testing');
    expect(a[SemanticConvention.GEN_AI_PROVIDER_NAME]).toBe('firecrawl');
    expect(a[SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]).toBe('firecrawl');
    expect(a[SemanticConvention.GEN_AI_OPERATION]).toBe('scrape');
    expect(a[SemanticConvention.GEN_AI_AGENT_TYPE]).toBe('browser');
    expect(a[SemanticConvention.SERVER_ADDRESS]).toBe('api.firecrawl.dev');
    expect(a[SemanticConvention.SERVER_PORT]).toBe(443);
    expect(a[SemanticConvention.GEN_AI_SDK_VERSION]).toBe('1.29.3');
    expect(a[SemanticConvention.GEN_AI_AGENT_BROWSE_URL]).toBe('https://example.com');
    expect(a[SemanticConvention.GEN_AI_CRAWL_RESULT_SUCCESS]).toBe(true);
    expect(a[SemanticConvention.GEN_AI_CRAWL_RESULT_MARKDOWN_LENGTH]).toBe(
      '# Example Domain\nThis is example content.'.length
    );
    expect(a[SemanticConvention.GEN_AI_CRAWL_RESULT_LINKS_COUNT]).toBe(2);
    expect(a[SemanticConvention.GEN_AI_CRAWL_RESULT_STATUS_CODE]).toBe(200);
    expect(a[SemanticConvention.GEN_AI_RESPONSE_TITLE]).toBe('Example');
    expect(a[SemanticConvention.GEN_AI_INPUT_MESSAGES]).toBe('https://example.com');
    expect(a[SemanticConvention.GEN_AI_OUTPUT_MESSAGES]).toBe(
      '# Example Domain\nThis is example content.'
    );
    expect(typeof a[SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION]).toBe('number');
    expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 1 });
    expect(mockSpan.end).toHaveBeenCalledTimes(1);
  });

  it('names crawlUrl spans crawl and reads the url from options', async () => {
    const wrapped = FirecrawlWrapper._patchOperation(mockTracer, 'firecrawl.crawl_url')(
      jest.fn().mockResolvedValue({ success: true, status: 'completed', total: 5, completed: 5 })
    );
    await wrapped.call({}, { url: 'https://example.com', limit: 10 });

    expect(mockTracer.startSpan).toHaveBeenCalledWith(
      'crawl https://example.com',
      expect.objectContaining({ kind: SpanKind.CLIENT })
    );
    const a = attrs();
    expect(a[SemanticConvention.GEN_AI_OPERATION]).toBe('crawl');
    expect(a[SemanticConvention.GEN_AI_MONITOR_TASK_STATUS]).toBe('completed');
    expect(a[SemanticConvention.GEN_AI_RESPONSE_COMPLETION_RATE]).toBe(100);
  });

  it('uses crawl_status for checkCrawlStatus (not scrape fallback)', async () => {
    const wrapped = FirecrawlWrapper._patchOperation(mockTracer, 'firecrawl.crawl_status')(
      jest.fn().mockResolvedValue({ success: true, status: 'scraping', id: 'job-1' })
    );
    await wrapped.call({}, 'job-1');

    expect(mockTracer.startSpan).toHaveBeenCalledWith(
      'crawl_status job-1',
      expect.objectContaining({ kind: SpanKind.CLIENT })
    );
    const a = attrs();
    expect(a[SemanticConvention.GEN_AI_OPERATION]).toBe('crawl_status');
    expect(a[SemanticConvention.GEN_AI_MONITOR_TASK_STATUS]).toBe('scraping');
    expect(a[SemanticConvention.GEN_AI_RESPONSE_JOB_ID]).toBe('job-1');
  });

  it('names extract spans extract with URL list (not scrape unknown)', async () => {
    const wrapped = FirecrawlWrapper._patchOperation(mockTracer, 'firecrawl.extract')(
      jest.fn().mockResolvedValue({ success: true, data: { answer: 42 } })
    );
    await wrapped.call({}, ['https://a.com', 'https://b.com'], { prompt: 'summarize' });

    expect(mockTracer.startSpan).toHaveBeenCalledWith(
      'extract [https://a.com, https://b.com]',
      expect.objectContaining({ kind: SpanKind.CLIENT })
    );
    const a = attrs();
    expect(a[SemanticConvention.GEN_AI_OPERATION]).toBe('extract');
    expect(a[SemanticConvention.GEN_AI_CRAWL_URL_COUNT]).toBe(2);
    expect(a[SemanticConvention.GEN_AI_AGENT_BROWSE_URL]).toBe('https://a.com');
  });

  it('maps asyncExtract to extract operation', async () => {
    const wrapped = FirecrawlWrapper._patchOperation(mockTracer, 'firecrawl.async_extract')(
      jest.fn().mockResolvedValue({ success: true, id: 'ext-1' })
    );
    await wrapped.call({}, ['https://a.com']);

    const a = attrs();
    expect(a[SemanticConvention.GEN_AI_OPERATION]).toBe('extract');
    expect((mockTracer.startSpan as jest.Mock).mock.calls[0][0]).toBe('extract [https://a.com]');
  });

  it('maps cancelCrawl to cancel operation', async () => {
    const wrapped = FirecrawlWrapper._patchOperation(mockTracer, 'firecrawl.cancel_crawl')(
      jest.fn().mockResolvedValue({ success: true })
    );
    await wrapped.call({}, 'job-99');

    expect(mockTracer.startSpan).toHaveBeenCalledWith(
      'cancel job-99',
      expect.objectContaining({ kind: SpanKind.CLIENT })
    );
    expect(attrs()[SemanticConvention.GEN_AI_OPERATION]).toBe('cancel');
  });

  it('maps checkBatchScrapeStatus to scrape_status', async () => {
    const wrapped = FirecrawlWrapper._patchOperation(mockTracer, 'firecrawl.get_scrape_status')(
      jest.fn().mockResolvedValue({ success: true, status: 'completed' })
    );
    await wrapped.call({}, 'batch-1');

    expect(attrs()[SemanticConvention.GEN_AI_OPERATION]).toBe('scrape_status');
    expect(attrs()[SemanticConvention.GEN_AI_MONITOR_TASK_STATUS]).toBe('completed');
  });

  it('summarizes batchScrapeUrls list responses', async () => {
    const wrapped = FirecrawlWrapper._patchOperation(mockTracer, 'firecrawl.batch_scrape_urls')(
      jest.fn().mockResolvedValue([{ success: true }, { success: false }])
    );
    await wrapped.call({}, ['https://a.com', 'https://b.com']);

    const spanName = (mockTracer.startSpan as jest.Mock).mock.calls[0][0];
    expect(spanName).toBe('scrape [https://a.com, https://b.com]');
    const a = attrs();
    expect(a[SemanticConvention.GEN_AI_CRAWL_URL_COUNT]).toBe(2);
    expect(a[SemanticConvention.GEN_AI_CRAWL_RESULT_SUCCESS_COUNT]).toBe(1);
    expect(a[SemanticConvention.GEN_AI_CRAWL_RESULT_SUCCESS_RATE]).toBe(0.5);
  });

  it('records errors, sets the error category and still ends the span', async () => {
    const wrapped = FirecrawlWrapper._patchOperation(mockTracer, 'firecrawl.scrape_url')(
      jest.fn().mockRejectedValue(new Error('Rate limit exceeded'))
    );

    await expect(wrapped.call({}, 'https://example.com')).rejects.toThrow('Rate limit exceeded');

    const a = attrs();
    expect(a[SemanticConvention.ERROR_MESSAGE]).toBe('Rate limit exceeded');
    expect(a[SemanticConvention.ERROR_CATEGORY]).toBe('rate_limit');
    expect(OpenLitHelper.handleException).toHaveBeenCalledWith(
      mockSpan,
      expect.objectContaining({ message: 'Rate limit exceeded' })
    );
    expect(mockSpan.end).toHaveBeenCalledTimes(1);
  });

  it('bypasses instrumentation when tracing is suppressed', async () => {
    (isTracingSuppressed as jest.Mock).mockReturnValue(true);
    const original = jest.fn().mockResolvedValue({ success: true });
    const wrapped = FirecrawlWrapper._patchOperation(mockTracer, 'firecrawl.scrape_url')(original);

    await wrapped.call({}, 'https://example.com');
    expect(original).toHaveBeenCalled();
    expect(mockTracer.startSpan).not.toHaveBeenCalled();
  });
});

describe('FirecrawlInstrumentation patch targets', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { isWrapped } = require('@opentelemetry/instrumentation');

  it('wraps FirecrawlApp Promise-returning methods including extract/status/cancel', () => {
    class FirecrawlApp {
      async scrapeUrl() {
        return null;
      }
      async crawlUrl() {
        return null;
      }
      async asyncCrawlUrl() {
        return null;
      }
      async mapUrl() {
        return null;
      }
      async search() {
        return null;
      }
      async extract() {
        return null;
      }
      async asyncExtract() {
        return null;
      }
      async getExtractStatus() {
        return null;
      }
      async batchScrapeUrls() {
        return null;
      }
      async asyncBatchScrapeUrls() {
        return null;
      }
      async checkCrawlStatus() {
        return null;
      }
      async checkBatchScrapeStatus() {
        return null;
      }
      async cancelCrawl() {
        return null;
      }
    }

    const fakeModule = { FirecrawlApp } as any;
    const instrumentation = new FirecrawlInstrumentation();
    instrumentation.manualPatch(fakeModule);

    const proto = fakeModule.FirecrawlApp.prototype;
    for (const method of [
      'scrapeUrl',
      'crawlUrl',
      'asyncCrawlUrl',
      'mapUrl',
      'search',
      'extract',
      'asyncExtract',
      'getExtractStatus',
      'batchScrapeUrls',
      'asyncBatchScrapeUrls',
      'checkCrawlStatus',
      'checkBatchScrapeStatus',
      'cancelCrawl',
    ]) {
      expect(isWrapped(proto[method])).toBe(true);
    }

    // Idempotent: second patch must not throw / rewrap
    instrumentation.manualPatch(fakeModule);
    expect(isWrapped(proto.scrapeUrl)).toBe(true);
  });
});
