jest.mock('@/middleware/chain', () => ({
  chain: jest.fn((middlewares: any[]) => ({ type: 'chained', middlewares })),
}));
jest.mock('@/middleware/check-auth', () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock('@/middleware/check-csrf', () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock('@/middleware/check-demo-account', () => ({
  __esModule: true,
  default: jest.fn(),
}));

import { chain } from '@/middleware/chain';
import checkAuth from '@/middleware/check-auth';
import checkCsrf from '@/middleware/check-csrf';
import checkDemoAccount from '@/middleware/check-demo-account';

// Re-import middleware module after mocks are registered
import { middleware, config } from '@/middleware';

describe('middleware', () => {
  it('composes checkCsrf, checkDemoAccount and checkAuth via chain', () => {
    expect(chain).toHaveBeenCalledWith([checkCsrf, checkDemoAccount, checkAuth]);
  });

  it('exports a middleware function', () => {
    expect(middleware).toBeDefined();
  });

  it('exports a config with matcher array', () => {
    expect(Array.isArray(config.matcher)).toBe(true);
    expect(config.matcher.length).toBeGreaterThan(0);
  });

  it('matcher includes /api/:path* route', () => {
    expect(config.matcher).toContain('/api/:path*');
  });

  it('matcher includes /login route', () => {
    expect(config.matcher).toContain('/login');
  });
});
