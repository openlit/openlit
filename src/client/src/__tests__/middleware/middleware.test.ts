jest.mock('@/middleware/chain', () => ({
  chain: jest.fn((middlewares: any[]) => ({ type: 'chained', middlewares })),
}));
jest.mock('@/middleware/check-auth', () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock('@/middleware/check-demo-account', () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock('@/middleware/check-csrf', () => ({
  __esModule: true,
  default: jest.fn(),
}));

import { chain } from '@/middleware/chain';
import checkAuth from '@/middleware/check-auth';
import checkDemoAccount from '@/middleware/check-demo-account';
import checkCsrf from '@/middleware/check-csrf';

// Re-import middleware module after mocks are registered
import { middleware, config } from '@/middleware';

describe('middleware', () => {
  it('composes security and auth middleware via chain', () => {
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

  it('does not include enterprise-only routes in CE', () => {
    expect(config.matcher).not.toContain('/audit-logs');
    expect(config.matcher).not.toContain('/audit-logs/:path*');
  });

  it('matches the agents routes', () => {
    expect(config.matcher).toContain('/agents');
    expect(config.matcher).toContain('/agents/:path*');
  });

  // Regression: pages omitted from the matcher skip auth entirely and
  // render the playground shell while unauthenticated (APIs still 307).
  it('matches organisation, connectors, costs, and evaluations routes', () => {
    expect(config.matcher).toContain('/organisation');
    expect(config.matcher).toContain('/organisation/:path*');
    expect(config.matcher).toContain('/connectors');
    expect(config.matcher).toContain('/costs');
    expect(config.matcher).toContain('/evaluations');
    expect(config.matcher).toContain('/evaluations/:path*');
  });

  it('matches nested playground routes that previously bypassed auth', () => {
    expect(config.matcher).toContain('/openground/:path*');
    expect(config.matcher).toContain('/prompt-hub/:path*');
    expect(config.matcher).toContain('/fleet-hub/:path*');
    expect(config.matcher).toContain('/rule-engine');
    expect(config.matcher).toContain('/rule-engine/:path*');
    expect(config.matcher).toContain('/context');
    expect(config.matcher).toContain('/context/:path*');
    expect(config.matcher).toContain('/coding-agents/:path*');
    expect(config.matcher).toContain('/pricing');
    expect(config.matcher).toContain('/manage-models');
  });

  // Regression guard for the `^/.*$` fallback: Next.js can't statically
  // analyze a spread of an imported binding in `config.matcher`, so it
  // silently matches every route — which made middleware run on static
  // assets (/images, /static → 500) and public files (/robots.txt →
  // redirect to /login). The matcher must stay a literal list of explicit
  // route patterns with no catch-all entry.
  it('has no catch-all matcher entry', () => {
    const catchAlls = ['/', '/:path*', '/(.*)', '/:path', '/*'];
    for (const entry of config.matcher) {
      expect(typeof entry).toBe('string');
      expect(catchAlls).not.toContain(entry);
    }
  });

  it('does not match static asset or public-file prefixes', () => {
    const shouldNeverMatch = ['/images', '/static', '/_next', '/favicon.ico', '/robots.txt'];
    for (const entry of config.matcher) {
      for (const asset of shouldNeverMatch) {
        expect(entry.startsWith(asset)).toBe(false);
      }
    }
  });
});
