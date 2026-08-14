import {
  DEFAULT_LOGGED_IN_ROUTE,
  ALLOWED_OPENLIT_ROUTES_WITHOUT_TOKEN,
  CRON_JOB_ROUTES,
  ONBOARDING_WHITELIST_ROUTES,
  ONBOARDING_WHITELIST_API_ROUTES,
  RESTRICTED_DEMO_ACCOUNT_ROUTES,
} from '@/constants/route';

describe('DEFAULT_LOGGED_IN_ROUTE', () => {
  it('is the /home route', () => {
    expect(DEFAULT_LOGGED_IN_ROUTE).toBe('/home');
  });
});

describe('ALLOWED_OPENLIT_ROUTES_WITHOUT_TOKEN', () => {
  it('is an array', () => {
    expect(Array.isArray(ALLOWED_OPENLIT_ROUTES_WITHOUT_TOKEN)).toBe(true);
  });

  it('includes the prompt get-compiled route', () => {
    expect(ALLOWED_OPENLIT_ROUTES_WITHOUT_TOKEN).toContain('/api/prompt/get-compiled');
  });

  it('includes the vault get-secrets route', () => {
    expect(ALLOWED_OPENLIT_ROUTES_WITHOUT_TOKEN).toContain('/api/vault/get-secrets');
  });
});

describe('CRON_JOB_ROUTES', () => {
  it('is an array', () => {
    expect(Array.isArray(CRON_JOB_ROUTES)).toBe(true);
  });

  it('includes the evaluation auto route', () => {
    expect(CRON_JOB_ROUTES).toContain('/api/evaluation/auto');
  });
});

describe('ONBOARDING_WHITELIST_ROUTES', () => {
  it('is an array', () => {
    expect(Array.isArray(ONBOARDING_WHITELIST_ROUTES)).toBe(true);
  });

  it('includes the /onboarding route', () => {
    expect(ONBOARDING_WHITELIST_ROUTES).toContain('/onboarding');
  });
});

describe('ONBOARDING_WHITELIST_API_ROUTES', () => {
  it('has exact and prefix keys', () => {
    expect(ONBOARDING_WHITELIST_API_ROUTES).toHaveProperty('exact');
    expect(ONBOARDING_WHITELIST_API_ROUTES).toHaveProperty('prefix');
  });

  it('exact.GET includes /api/organisation', () => {
    expect(ONBOARDING_WHITELIST_API_ROUTES.exact.GET).toContain('/api/organisation');
  });

  it('exact.POST includes /api/organisation', () => {
    expect(ONBOARDING_WHITELIST_API_ROUTES.exact.POST).toContain('/api/organisation');
  });

  it('prefix.POST includes /api/organisation/current/', () => {
    expect(ONBOARDING_WHITELIST_API_ROUTES.prefix.POST).toContain('/api/organisation/current/');
  });

  it('prefix.DELETE includes /api/organisation/invitation/', () => {
    expect(ONBOARDING_WHITELIST_API_ROUTES.prefix.DELETE).toContain('/api/organisation/invitation/');
  });
});

describe('RESTRICTED_DEMO_ACCOUNT_ROUTES', () => {
  it('is an object', () => {
    expect(typeof RESTRICTED_DEMO_ACCOUNT_ROUTES).toBe('object');
  });

  it('has POST, PUT, and DELETE keys', () => {
    expect(RESTRICTED_DEMO_ACCOUNT_ROUTES).toHaveProperty('POST');
    expect(RESTRICTED_DEMO_ACCOUNT_ROUTES).toHaveProperty('PUT');
    expect(RESTRICTED_DEMO_ACCOUNT_ROUTES).toHaveProperty('DELETE');
  });

  it('POST restricts /api/db-config and /api/user/profile', () => {
    expect(RESTRICTED_DEMO_ACCOUNT_ROUTES.POST).toContain('/api/db-config');
    expect(RESTRICTED_DEMO_ACCOUNT_ROUTES.POST).toContain('/api/user/profile');
  });

  it('DELETE restricts /api/vault and /api/prompt-hub', () => {
    expect(RESTRICTED_DEMO_ACCOUNT_ROUTES.DELETE).toContain('/api/vault');
    expect(RESTRICTED_DEMO_ACCOUNT_ROUTES.DELETE).toContain('/api/prompt-hub');
  });
});
