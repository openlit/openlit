import { NextResponse } from 'next/server';

// Mock next/server
jest.mock('next/server', () => ({
  NextResponse: {
    next: jest.fn(),
    json: jest.fn((body, init) => ({ body, init })),
  },
}));

// Mock next-auth/jwt
jest.mock('next-auth/jwt', () => ({
  getToken: jest.fn(),
}));

import checkDemoAccount from '@/middleware/check-demo-account';
import { getToken } from 'next-auth/jwt';

const makeRequest = (method: string, pathname: string) => ({
  method,
  nextUrl: { pathname },
});

const makeFetchEvent = () => ({} as any);

describe('checkDemoAccount', () => {
  const nextHandler = jest.fn();
  let middleware: ReturnType<typeof checkDemoAccount>;

  beforeEach(() => {
    jest.clearAllMocks();
    middleware = checkDemoAccount(nextHandler);
  });

  afterEach(() => {
    delete process.env.DEMO_ACCOUNT_EMAIL;
  });

  it('calls next() when DEMO_ACCOUNT_EMAIL is not set', async () => {
    delete process.env.DEMO_ACCOUNT_EMAIL;
    const req = makeRequest('POST', '/api/db-config');
    await middleware(req as any, makeFetchEvent());
    expect(nextHandler).toHaveBeenCalledWith(req, expect.anything());
  });

  it('calls next() when the route is not in RESTRICTED_DEMO_ACCOUNT_ROUTES', async () => {
    process.env.DEMO_ACCOUNT_EMAIL = 'demo@example.com';
    (getToken as jest.Mock).mockResolvedValue({ email: 'demo@example.com' });
    const req = makeRequest('GET', '/api/organisation');
    await middleware(req as any, makeFetchEvent());
    expect(nextHandler).toHaveBeenCalled();
  });

  it('calls next() when the token email does not match demo email', async () => {
    process.env.DEMO_ACCOUNT_EMAIL = 'demo@example.com';
    (getToken as jest.Mock).mockResolvedValue({ email: 'regular@example.com' });
    const req = makeRequest('POST', '/api/db-config');
    await middleware(req as any, makeFetchEvent());
    expect(nextHandler).toHaveBeenCalled();
  });

  it('returns 403 when demo user accesses a restricted route', async () => {
    process.env.DEMO_ACCOUNT_EMAIL = 'demo@example.com';
    (getToken as jest.Mock).mockResolvedValue({ email: 'demo@example.com' });
    const req = makeRequest('POST', '/api/db-config');
    const result = await middleware(req as any, makeFetchEvent());
    expect(NextResponse.json).toHaveBeenCalledWith(
      'This Action is not allowed for demo accounts!',
      { status: 403 }
    );
    expect(nextHandler).not.toHaveBeenCalled();
  });

  it('is case-insensitive for email comparison', async () => {
    process.env.DEMO_ACCOUNT_EMAIL = 'DEMO@EXAMPLE.COM';
    (getToken as jest.Mock).mockResolvedValue({ email: 'demo@example.com' });
    const req = makeRequest('DELETE', '/api/vault');
    const result = await middleware(req as any, makeFetchEvent());
    expect(NextResponse.json).toHaveBeenCalledWith(
      expect.any(String),
      { status: 403 }
    );
  });

  it('checks DELETE restricted routes correctly', async () => {
    process.env.DEMO_ACCOUNT_EMAIL = 'demo@example.com';
    (getToken as jest.Mock).mockResolvedValue({ email: 'demo@example.com' });
    const req = makeRequest('DELETE', '/api/api-key');
    await middleware(req as any, makeFetchEvent());
    expect(NextResponse.json).toHaveBeenCalledWith(
      expect.any(String),
      { status: 403 }
    );
  });

  it('calls next() for PUT on an unrestricted route', async () => {
    process.env.DEMO_ACCOUNT_EMAIL = 'demo@example.com';
    (getToken as jest.Mock).mockResolvedValue({ email: 'demo@example.com' });
    const req = makeRequest('PUT', '/api/something-else');
    await middleware(req as any, makeFetchEvent());
    expect(nextHandler).toHaveBeenCalled();
  });
});
