import { NextResponse } from 'next/server';

jest.mock('next/server', () => ({
  NextResponse: {
    next: jest.fn(() => ({ type: 'next' })),
    redirect: jest.fn((url) => ({ type: 'redirect', url: url.toString() })),
    json: jest.fn((body, init) => ({ type: 'json', body, init })),
  },
  NextRequest: jest.fn(function (this: any, base: any, init: any) {
    this.__base = base;
    this.headers = init?.headers;
  }),
}));

jest.mock('next-auth/middleware', () => ({
  withAuth: jest.fn((fn, opts) => fn),
}));

jest.mock('next-auth/jwt', () => ({
  getToken: jest.fn(),
}));

import checkAuth from '@/middleware/check-auth';
import { getToken } from 'next-auth/jwt';
import { withAuth } from 'next-auth/middleware';

const makeRequest = (
  method: string,
  pathname: string,
  search: string = '',
  headers: Record<string, string> = {}
) => ({
  method,
  nextUrl: { pathname, search },
  url: `http://localhost${pathname}`,
  headers: { get: (key: string) => headers[key] || null },
});

const makeFetchEvent = () => ({} as any);

describe('checkAuth', () => {
  const nextHandler = jest.fn((..._args: unknown[]) => ({ type: 'next' }));
  let middleware: any;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CRON_JOB_SECRET = 'secret-token';
    middleware = checkAuth(nextHandler as any);
  });

  // Static assets must short-circuit with a direct NextResponse.next()
  // pass-through, NOT by invoking the chain terminus as next(request, event)
  // — the terminus IS NextResponse.next, and calling it with the request as
  // the response init throws and 500s every /images and /static request.
  it('passes through _next static routes with NextResponse.next()', async () => {
    const req = makeRequest('GET', '/_next/static/chunk.js');
    await middleware(req as any, makeFetchEvent());
    expect(NextResponse.next).toHaveBeenCalled();
    expect(nextHandler).not.toHaveBeenCalled();
  });

  it('passes through /static routes with NextResponse.next()', async () => {
    const req = makeRequest('GET', '/static/logo.png');
    await middleware(req as any, makeFetchEvent());
    expect(NextResponse.next).toHaveBeenCalled();
    expect(nextHandler).not.toHaveBeenCalled();
  });

  it('passes through /images routes with NextResponse.next()', async () => {
    const req = makeRequest('GET', '/images/banner.png');
    await middleware(req as any, makeFetchEvent());
    expect(NextResponse.next).toHaveBeenCalled();
    expect(nextHandler).not.toHaveBeenCalled();
  });

  describe('Bearer token / API key auth', () => {
    afterEach(() => {
      delete (global as any).fetch;
    });

    it('rejects a Bearer token on a route that does not allow tokens', async () => {
      const req = makeRequest('GET', '/dashboard', '', { Authorization: 'Bearer abc123' });
      await middleware(req as any, makeFetchEvent());
      expect(NextResponse.json).toHaveBeenCalledWith(
        { error: 'Forbidden' },
        { status: 403 }
      );
      expect(nextHandler).not.toHaveBeenCalled();
    });

    it('rejects an empty API key', async () => {
      const req = makeRequest('GET', '/api/vault/get-secrets', '', { Authorization: 'Bearer   ' });
      await middleware(req as any, makeFetchEvent());
      expect(NextResponse.json).toHaveBeenCalledWith(
        { error: 'Invalid API key' },
        { status: 401 }
      );
    });

    it('rejects the API key when verify-key responds with a non-ok status', async () => {
      (global as any).fetch = jest.fn().mockResolvedValue({ ok: false });
      const req = makeRequest('GET', '/api/vault/get-secrets', '', { Authorization: 'Bearer key-1' });
      await middleware(req as any, makeFetchEvent());
      expect((global as any).fetch).toHaveBeenCalled();
      expect(NextResponse.json).toHaveBeenCalledWith(
        { error: 'Invalid API key' },
        { status: 401 }
      );
    });

    it('rejects the API key when verify-key reports it as invalid', async () => {
      (global as any).fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ valid: false }),
      });
      const req = makeRequest('GET', '/api/vault/get-secrets', '', { Authorization: 'Bearer key-1' });
      await middleware(req as any, makeFetchEvent());
      expect(NextResponse.json).toHaveBeenCalledWith(
        { error: 'Invalid API key' },
        { status: 401 }
      );
    });

    it('forwards the request with the resolved database config id when the key is valid', async () => {
      (global as any).fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ valid: true, databaseConfigId: 'db-config-1' }),
      });
      const req = makeRequest('GET', '/api/vault/get-secrets', '', { Authorization: 'Bearer key-1' });
      await middleware(req as any, makeFetchEvent());
      expect(nextHandler).toHaveBeenCalled();
      const forwardedRequest = nextHandler.mock.calls[0][0] as { headers: Headers };
      expect(forwardedRequest.headers.get('x-database-config-id')).toBe('db-config-1');
    });

    it('strips a client-supplied x-database-config-id on session API requests', async () => {
      (getToken as jest.Mock).mockResolvedValue({ hasCompletedOnboarding: true });
      const headers = new Headers({ 'x-database-config-id': 'victim-db' });
      const req = {
        method: 'GET',
        nextUrl: { pathname: '/api/some-endpoint', search: '' },
        url: 'http://localhost/api/some-endpoint',
        headers,
      };
      await middleware(req as any, makeFetchEvent());
      expect(NextResponse.next).toHaveBeenCalled();
      const forwarded = (NextResponse.next as jest.Mock).mock.calls.at(-1)?.[0];
      expect(forwarded.request.headers.get('x-database-config-id')).toBeNull();
    });

    it('returns 401 when the verify-key request throws', async () => {
      (global as any).fetch = jest.fn().mockRejectedValue(new Error('network down'));
      const req = makeRequest('GET', '/api/vault/get-secrets', '', { Authorization: 'Bearer key-1' });
      await middleware(req as any, makeFetchEvent());
      expect(NextResponse.json).toHaveBeenCalledWith(
        { error: 'Invalid API key' },
        { status: 401 }
      );
    });
  });

  describe('auth page (/login)', () => {
    it('redirects authenticated user to default route', async () => {
      (getToken as jest.Mock).mockResolvedValue({ hasCompletedOnboarding: true });
      const req = makeRequest('GET', '/login');
      await middleware(req as any, makeFetchEvent());
      expect(NextResponse.redirect).toHaveBeenCalled();
    });

    it('redirects authenticated user without onboarding to /onboarding', async () => {
      (getToken as jest.Mock).mockResolvedValue({ hasCompletedOnboarding: false });
      const req = makeRequest('GET', '/login');
      await middleware(req as any, makeFetchEvent());
      const redirectCall = (NextResponse.redirect as jest.Mock).mock.calls[0][0];
      expect(redirectCall.toString()).toContain('/onboarding');
    });

    it('allows unauthenticated access to login page', async () => {
      (getToken as jest.Mock).mockResolvedValue(null);
      const req = makeRequest('GET', '/login');
      await middleware(req as any, makeFetchEvent());
      expect(NextResponse.next).toHaveBeenCalled();
    });
  });

  describe('API routes', () => {
    it('allows authenticated API call', async () => {
      (getToken as jest.Mock).mockResolvedValue({ hasCompletedOnboarding: true });
      const req = makeRequest('GET', '/api/some-endpoint');
      await middleware(req as any, makeFetchEvent());
      expect(NextResponse.next).toHaveBeenCalled();
    });

    it('returns 403 for authenticated user without onboarding on restricted API', async () => {
      (getToken as jest.Mock).mockResolvedValue({ hasCompletedOnboarding: false });
      const req = makeRequest('GET', '/api/some-restricted-endpoint');
      await middleware(req as any, makeFetchEvent());
      expect(NextResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(String) }),
        { status: 403 }
      );
    });

    it('allows CRON job route with valid token header', async () => {
      (getToken as jest.Mock).mockResolvedValue(null);
      const req = makeRequest('GET', '/api/evaluation/auto', '', { 'X-CRON-JOB': 'secret-token' });
      await middleware(req as any, makeFetchEvent());
      expect(NextResponse.next).toHaveBeenCalled();
    });

    it('rejects CRON job route with 403 when token does not match configured secret', async () => {
      (getToken as jest.Mock).mockResolvedValue(null);
      // With a secret configured, the keyless "true" sentinel must NOT pass.
      const req = makeRequest('GET', '/api/evaluation/auto', '', { 'X-CRON-JOB': 'true' });
      await middleware(req as any, makeFetchEvent());
      expect(NextResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(String) }),
        { status: 403 }
      );
      expect(NextResponse.next).not.toHaveBeenCalled();
    });

    it('accepts CRON job route with "true" sentinel when no secret is configured', async () => {
      // Self-hosted/dev default: CRON_JOB_SECRET unset, scripts send "true".
      delete process.env.CRON_JOB_SECRET;
      middleware = checkAuth(nextHandler as any);
      (getToken as jest.Mock).mockResolvedValue(null);
      const req = makeRequest('GET', '/api/evaluation/auto', '', { 'X-CRON-JOB': 'true' });
      await middleware(req as any, makeFetchEvent());
      expect(NextResponse.next).toHaveBeenCalled();
    });

    it('reads the lowercase x-cron-job header', async () => {
      (getToken as jest.Mock).mockResolvedValue(null);
      const req = makeRequest('GET', '/api/evaluation/auto', '', { 'x-cron-job': 'secret-token' });
      await middleware(req as any, makeFetchEvent());
      expect(NextResponse.next).toHaveBeenCalled();
    });
  });

  describe('rate limiting sensitive API prefixes', () => {
    it('uses the x-real-ip header when x-forwarded-for is absent', async () => {
      (getToken as jest.Mock).mockResolvedValue({ hasCompletedOnboarding: true });
      const req = makeRequest('GET', '/api/organisation', '', { 'x-real-ip': '10.0.0.5' });
      await middleware(req as any, makeFetchEvent());
      expect(NextResponse.next).toHaveBeenCalled();
    });

    it('falls back to "unknown" when no client ip headers are present', async () => {
      (getToken as jest.Mock).mockResolvedValue({ hasCompletedOnboarding: true });
      const req = makeRequest('GET', '/api/organisation');
      await middleware(req as any, makeFetchEvent());
      expect(NextResponse.next).toHaveBeenCalled();
    });

    it('sweeps expired rate-limit windows on the periodic cleanup pass', async () => {
      (getToken as jest.Mock).mockResolvedValue({ hasCompletedOnboarding: true });
      const headers = { 'x-forwarded-for': '192.0.2.55' };

      // Seed a window for this key using the real clock.
      const realNow = Date.now();
      await middleware(makeRequest('GET', '/api/organisation', '', headers) as any, makeFetchEvent());

      // Jump far enough forward that both this key's window AND the global
      // cleanup timer are due, forcing the forEach sweep to delete it.
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(realNow + 10 * 60_000);
      try {
        (NextResponse.next as jest.Mock).mockClear();
        await middleware(makeRequest('GET', '/api/organisation', '', headers) as any, makeFetchEvent());
        expect(NextResponse.next).toHaveBeenCalled();
      } finally {
        nowSpy.mockRestore();
      }
    });

    it('returns 429 once the request count in the current window exceeds the limit', async () => {
      (getToken as jest.Mock).mockResolvedValue({ hasCompletedOnboarding: true });
      const headers = { 'x-forwarded-for': '203.0.113.9' };
      for (let i = 0; i < 1200; i++) {
        const req = makeRequest('GET', '/api/organisation', '', headers);
        await middleware(req as any, makeFetchEvent());
      }
      (NextResponse.json as jest.Mock).mockClear();
      const finalReq = makeRequest('GET', '/api/organisation', '', headers);
      await middleware(finalReq as any, makeFetchEvent());
      expect(NextResponse.json).toHaveBeenCalledWith(
        { error: 'Too many requests' },
        { status: 429 }
      );
    });
  });

  describe('onboarding whitelist method lookups', () => {
    it('treats a method with no configured prefix whitelist as having none', async () => {
      (getToken as jest.Mock).mockResolvedValue({ hasCompletedOnboarding: true });
      const req = makeRequest('HEAD', '/api/some-endpoint');
      await middleware(req as any, makeFetchEvent());
      expect(NextResponse.next).toHaveBeenCalled();
    });
  });

  describe('unauthenticated request to a non-whitelisted API route', () => {
    it('returns 401 Unauthorized without redirecting', async () => {
      (getToken as jest.Mock).mockResolvedValue(null);
      const req = makeRequest('GET', '/api/some-restricted-endpoint', '', {
        'x-forwarded-for': '198.51.100.1',
      });
      await middleware(req as any, makeFetchEvent());
      expect(NextResponse.json).toHaveBeenCalledWith(
        { error: 'Unauthorized' },
        { status: 401 }
      );
      expect(NextResponse.redirect).not.toHaveBeenCalled();
    });
  });

  describe('unauthenticated access to protected pages', () => {
    it('redirects to login with callbackUrl', async () => {
      (getToken as jest.Mock).mockResolvedValue(null);
      const req = makeRequest('GET', '/dashboard');
      await middleware(req as any, makeFetchEvent());
      expect(NextResponse.redirect).toHaveBeenCalled();
      const redirectCall = (NextResponse.redirect as jest.Mock).mock.calls[0][0];
      expect(redirectCall.toString()).toContain('/login');
      expect(redirectCall.toString()).toContain('callbackUrl');
    });

    it('includes search params in callbackUrl', async () => {
      (getToken as jest.Mock).mockResolvedValue(null);
      const req = makeRequest('GET', '/dashboard', '?tab=settings');
      await middleware(req as any, makeFetchEvent());
      const redirectCall = (NextResponse.redirect as jest.Mock).mock.calls[0][0];
      expect(redirectCall.toString()).toContain('dashboard');
    });
  });

  describe('authenticated user without onboarding on pages', () => {
    it('redirects to /onboarding for non-whitelisted pages', async () => {
      (getToken as jest.Mock).mockResolvedValue({ hasCompletedOnboarding: false });
      const req = makeRequest('GET', '/dashboard');
      await middleware(req as any, makeFetchEvent());
      const redirectCall = (NextResponse.redirect as jest.Mock).mock.calls[0][0];
      expect(redirectCall.toString()).toContain('/onboarding');
    });

    it('allows organisation setup pages before project setup is complete', async () => {
      (getToken as jest.Mock).mockResolvedValue({ hasCompletedOnboarding: false });
      const req = makeRequest('GET', '/organisation');
      await middleware(req as any, makeFetchEvent());
      expect(NextResponse.next).toHaveBeenCalled();
      expect(NextResponse.redirect).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('redirects to login when getToken throws an error', async () => {
      (getToken as jest.Mock).mockRejectedValue(new Error('Invalid token'));
      const req = makeRequest('GET', '/dashboard');
      await middleware(req as any, makeFetchEvent());
      expect(NextResponse.redirect).toHaveBeenCalled();
    });

    it('includes search params in callbackUrl when error occurs', async () => {
      (getToken as jest.Mock).mockRejectedValue(new Error('Invalid token'));
      const req = makeRequest('GET', '/dashboard', '?ref=abc');
      await middleware(req as any, makeFetchEvent());
      const redirectCall = (NextResponse.redirect as jest.Mock).mock.calls[0][0];
      expect(redirectCall.toString()).toContain('callbackUrl');
    });

    it('allows access to login page even when getToken throws', async () => {
      (getToken as jest.Mock).mockRejectedValue(new Error('Invalid token'));
      const req = makeRequest('GET', '/login');
      await middleware(req as any, makeFetchEvent());
      expect(NextResponse.next).toHaveBeenCalled();
    });
  });

  describe('authenticated user with completed onboarding on regular pages', () => {
    it('allows access and returns next()', async () => {
      (getToken as jest.Mock).mockResolvedValue({ hasCompletedOnboarding: true });
      const req = makeRequest('GET', '/dashboard');
      await middleware(req as any, makeFetchEvent());
      expect(NextResponse.next).toHaveBeenCalled();
    });
  });

  describe('onboarding-whitelisted API routes (exact match)', () => {
    it('allows GET to /api/organisation without onboarding', async () => {
      (getToken as jest.Mock).mockResolvedValue({ hasCompletedOnboarding: false });
      const req = makeRequest('GET', '/api/organisation');
      await middleware(req as any, makeFetchEvent());
      expect(NextResponse.next).toHaveBeenCalled();
      expect(NextResponse.json).not.toHaveBeenCalled();
    });

    it('allows POST to /api/organisation without onboarding', async () => {
      (getToken as jest.Mock).mockResolvedValue({ hasCompletedOnboarding: false });
      const req = makeRequest('POST', '/api/organisation');
      await middleware(req as any, makeFetchEvent());
      expect(NextResponse.next).toHaveBeenCalled();
    });

    it('allows GET to /api/db-config without onboarding so step 3 can list ClickHouse configs', async () => {
      (getToken as jest.Mock).mockResolvedValue({ hasCompletedOnboarding: false });
      const req = makeRequest('GET', '/api/db-config');
      await middleware(req as any, makeFetchEvent());
      expect(NextResponse.next).toHaveBeenCalled();
      expect(NextResponse.json).not.toHaveBeenCalled();
    });

    it('allows POST to /api/db-config without onboarding so step 3 can save ClickHouse configs', async () => {
      (getToken as jest.Mock).mockResolvedValue({ hasCompletedOnboarding: false });
      const req = makeRequest('POST', '/api/db-config');
      await middleware(req as any, makeFetchEvent());
      expect(NextResponse.next).toHaveBeenCalled();
      expect(NextResponse.json).not.toHaveBeenCalled();
    });

    it('allows GET to /api/project/environment without onboarding', async () => {
      (getToken as jest.Mock).mockResolvedValue({ hasCompletedOnboarding: false });
      const req = makeRequest('GET', '/api/project/environment');
      await middleware(req as any, makeFetchEvent());
      expect(NextResponse.next).toHaveBeenCalled();
      expect(NextResponse.json).not.toHaveBeenCalled();
    });

    it('allows POST to /api/clickhouse without onboarding so the db config form can ping', async () => {
      (getToken as jest.Mock).mockResolvedValue({ hasCompletedOnboarding: false });
      const req = makeRequest('POST', '/api/clickhouse');
      await middleware(req as any, makeFetchEvent());
      expect(NextResponse.next).toHaveBeenCalled();
      expect(NextResponse.json).not.toHaveBeenCalled();
    });
  });

  describe('onboarding-whitelisted API routes (prefix match)', () => {
    it('allows organisation management APIs without onboarding completion', async () => {
      (getToken as jest.Mock).mockResolvedValue({ hasCompletedOnboarding: false });
      const req = makeRequest('GET', '/api/organisation/org-1/projects');
      await middleware(req as any, makeFetchEvent());
      expect(NextResponse.next).toHaveBeenCalled();
      expect(NextResponse.json).not.toHaveBeenCalled();
    });

    it('allows POST to /api/organisation/current/123 without onboarding', async () => {
      (getToken as jest.Mock).mockResolvedValue({ hasCompletedOnboarding: false });
      const req = makeRequest('POST', '/api/organisation/current/123');
      await middleware(req as any, makeFetchEvent());
      expect(NextResponse.next).toHaveBeenCalled();
      expect(NextResponse.json).not.toHaveBeenCalled();
    });

    it('allows DELETE to /api/organisation/invitation/456 without onboarding', async () => {
      (getToken as jest.Mock).mockResolvedValue({ hasCompletedOnboarding: false });
      const req = makeRequest('DELETE', '/api/organisation/invitation/456');
      await middleware(req as any, makeFetchEvent());
      expect(NextResponse.next).toHaveBeenCalled();
    });

    it('allows POST to /api/db-config/current/:id without onboarding', async () => {
      (getToken as jest.Mock).mockResolvedValue({ hasCompletedOnboarding: false });
      const req = makeRequest('POST', '/api/db-config/current/db-1');
      await middleware(req as any, makeFetchEvent());
      expect(NextResponse.next).toHaveBeenCalled();
      expect(NextResponse.json).not.toHaveBeenCalled();
    });
  });

  describe('withAuth callbacks.authorized', () => {
    it('is called by withAuth and always returns true', async () => {
      const capturedOpts = (withAuth as jest.Mock).mock.calls[0]?.[1];
      if (capturedOpts?.callbacks?.authorized) {
        const result = await capturedOpts.callbacks.authorized();
        expect(result).toBe(true);
      }
    });
  });
});
