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
    expect(a['gen_ai.response.title']).toBe('Example');
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
    expect(a['gen_ai.response.completion_rate']).toBe(100);
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
    expect(a['gen_ai.crawl.result.success_count']).toBe(1);
    expect(a['gen_ai.crawl.result.success_rate']).toBe(0.5);
  });

  it('records errors, sets the error category and still ends the span', async () => {
    const wrapped = FirecrawlWrapper._patchOperation(mockTracer, 'firecrawl.scrape_url')(
      jest.fn().mockRejectedValue(new Error('Rate limit exceeded'))
    );

    await expect(wrapped.call({}, 'https://example.com')).rejects.toThrow('Rate limit exceeded');

    const a = attrs();
    expect(a['error.message']).toBe('Rate limit exceeded');
    expect(a['error.category']).toBe('rate_limit');
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

  it('wraps the FirecrawlApp Promise-returning methods', () => {
    class FirecrawlApp {
      async scrapeUrl() {
        return null;
      }
      async crawlUrl() {
        return null;
      }
      async mapUrl() {
        return null;
      }
      async search() {
        return null;
      }
      async batchScrapeUrls() {
        return null;
      }
      async checkCrawlStatus() {
        return null;
      }
    }

    const fakeModule = { FirecrawlApp } as any;
    const instrumentation = new FirecrawlInstrumentation();
    instrumentation.manualPatch(fakeModule);

    expect(isWrapped(fakeModule.FirecrawlApp.prototype.scrapeUrl)).toBe(true);
    expect(isWrapped(fakeModule.FirecrawlApp.prototype.crawlUrl)).toBe(true);
    expect(isWrapped(fakeModule.FirecrawlApp.prototype.mapUrl)).toBe(true);
    expect(isWrapped(fakeModule.FirecrawlApp.prototype.search)).toBe(true);
    expect(isWrapped(fakeModule.FirecrawlApp.prototype.batchScrapeUrls)).toBe(true);
    expect(isWrapped(fakeModule.FirecrawlApp.prototype.checkCrawlStatus)).toBe(true);
  });
});
