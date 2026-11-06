import { trace } from '@opentelemetry/api';
import { getTracer } from '../../manual-trace';
import SemanticConvention from '../../semantic-convention';
import TypeSafeWrapper from '../typesafe/wrapper';

export type FetchAdapterName = 'typesafe';

type Adapter = {
  matches(url: URL): boolean;
  /** Runs `send` inside the provider's own span, and returns the decoded body to it. */
  trace(url: URL, body: any, send: () => Promise<unknown>): Promise<unknown>;
};

class HttpFailure extends Error {
  constructor(readonly response: Response) {
    super(`HTTP ${response.status}`);
  }
}

const ADAPTERS: Record<FetchAdapterName, Adapter> = {
  // Shares the span with the patched SDK method, so both report identically.
  typesafe: {
    matches: (url) => url.hostname === 'api.typesafe.ai' && url.pathname.toLowerCase().startsWith('/v1/systemone'),
    trace(url, body, send) {
      const patched = TypeSafeWrapper._patchSystemOne(getTracer())(send);
      return patched.call({ baseURL: url.origin }, body);
    },
  },
};

function requestUrl(input: RequestInfo | URL): URL | undefined {
  try {
    if (input instanceof URL) return input;
    return new URL(typeof input === 'string' ? input : input.url);
  } catch {
    return undefined;
  }
}

async function requestBody(input: RequestInfo | URL, init?: RequestInit): Promise<unknown> {
  const raw =
    init?.body ??
    (typeof Request !== 'undefined' && input instanceof Request ? await input.clone().text() : undefined);
  return typeof raw === 'string' ? JSON.parse(raw) : undefined;
}

// The patched SDK method already opened a span around this request.
function insidePatchedCall(): boolean {
  const attributes = (trace.getActiveSpan() as any)?.attributes;
  return attributes?.[SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL] === SemanticConvention.GEN_AI_SYSTEM_TYPESAFE;
}

/**
 * Trace direct HTTP calls to the named APIs by wrapping `globalThis.fetch`.
 * Other requests pass through untouched, and the caller gets the original
 * `Response`. Returns a function that restores `fetch`.
 */
export function instrumentFetch(names: FetchAdapterName[]): () => void {
  const original = globalThis.fetch;
  const adapters = names.map((name) => ADAPTERS[name]).filter(Boolean);

  const wrapped = async function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
    const url = requestUrl(input);
    const adapter = url && adapters.find((candidate) => candidate.matches(url));
    if (!url || !adapter || insidePatchedCall()) return original.call(this, input, init);

    let body: unknown;
    try {
      body = await requestBody(input, init);
    } catch {
      return original.call(this, input, init);
    }

    let response: Response | undefined;
    try {
      await adapter.trace(url, body, async () => {
        response = await original.call(this, input, init);
        if (!response!.ok) throw new HttpFailure(response!);
        return response!.clone().json();
      });
      return response!;
    } catch (error) {
      if (response) return response;
      throw error;
    }
  } as typeof fetch;

  globalThis.fetch = wrapped;
  return () => {
    if (globalThis.fetch === wrapped) globalThis.fetch = original;
  };
}
