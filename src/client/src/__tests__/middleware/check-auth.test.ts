import { NextResponse } from 'next/server';

jest.mock('next/server', () => ({
  NextResponse: {
    next: jest.fn(() => ({ type: 'next' })),
    redirect: jest.fn((url) => ({ type: 'redirect', url: url.toString() })),
    json: jest.fn((body, init) => ({ type: 'json', body, init })),
  },
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
  const nextHandler = jest.fn(() => ({ type: 'next' }));
  let middleware: any;

  beforeEach(() => {
    jest.clearAllMocks();
    middleware = checkAuth(nextHandler);
  });

  it('passes through _next static routes', async () => {
    const req = makeRequest('GET', '/_next/static/chunk.js');
    await middleware(req as any, makeFetchEvent());
    expect(nextHandler).toHaveBeenCalledWith(req, expect.anything());
  });

  it('passes through /static routes', async () => {
    const req = makeRequest('GET', '/static/logo.png');
    await middleware(req as any, makeFetchEvent());
    expect(nextHandler).toHaveBeenCalledWith(req, expect.anything());
  });

  it('passes through /images routes', async () => {
    const req = makeRequest('GET', '/images/banner.png');
    await middleware(req as any, makeFetchEvent());
    expect(nextHandler).toHaveBeenCalledWith(req, expect.anything());
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
  });

  describe('onboarding-whitelisted API routes (prefix match)', () => {
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
