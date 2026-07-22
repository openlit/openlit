import {
  generatePageHeader,
  updatePageHeaderWithData,
  extractRouteParams,
} from '@/utils/breadcrumbs';

describe('extractRouteParams', () => {
  it('returns empty object when pathname does not match regex', () => {
    const result = extractRouteParams('/no-match', /^\/does-not-match$/);
    expect(result).toEqual({});
  });

  it('extracts id from prompt-hub pathname', () => {
    const result = extractRouteParams(
      '/prompt-hub/my-prompt-id',
      /^\/prompt-hub\/[^/]+$/
    );
    expect(result.id).toBe('my-prompt-id');
  });

  it('extracts id from vault pathname', () => {
    const result = extractRouteParams('/vault/my-secret', /^\/vault\/[^/]+$/);
    expect(result.id).toBe('my-secret');
  });

  it('extracts id from openground pathname', () => {
    const result = extractRouteParams(
      '/openground/some-run',
      /^\/openground\/[^/]+$/
    );
    expect(result.id).toBe('some-run');
  });

  it('extracts uuid when regex source contains escaped brackets (\\[0-9a-f\\])', () => {
    // Use a regex whose .source includes \[0-9a-f\] to trigger the UUID extraction branch
    const regex = new RegExp('.+\\[0-9a-f\\].+');
    const pathname = '/d/[0-9a-f]/123e4567-e89b-12d3-a456-426614174000';
    const result = extractRouteParams(pathname, regex);
    expect(result.id).toBe('123e4567-e89b-12d3-a456-426614174000');
  });

  it('returns empty id when regex source has escaped brackets but pathname has no UUID', () => {
    const regex = new RegExp('.+\\[0-9a-f\\].+');
    const pathname = '/d/[0-9a-f]/no-uuid-here';
    const result = extractRouteParams(pathname, regex);
    expect(result.id).toBeUndefined();
  });
});

describe('generatePageHeader', () => {
  it('generates correct header for /home', () => {
    const header = generatePageHeader('/home');
    expect(header.title).toBe('Home');
    expect(header.breadcrumbs).toEqual([]);
  });

  it('generates correct header for /dashboard', () => {
    const header = generatePageHeader('/dashboard');
    expect(header.title).toBe('Dashboard');
    expect(header.breadcrumbs).toEqual([]);
  });

  it('generates header with empty title for individual dashboard view', () => {
    const header = generatePageHeader(
      '/d/123e4567-e89b-12d3-a456-426614174000'
    );
    expect(header.title).toBe('');
    expect(header.breadcrumbs).toEqual([]);
  });

  it('generates correct header for /requests', () => {
    const header = generatePageHeader('/requests');
    expect(header.title).toBe('Requests');
    expect(header.breadcrumbs).toEqual([]);
  });

  it('generates correct header for /exceptions', () => {
    const header = generatePageHeader('/exceptions');
    expect(header.title).toBe('Exceptions');
    expect(header.breadcrumbs).toEqual([]);
  });

  it('generates correct header for /prompt-hub', () => {
    const header = generatePageHeader('/prompt-hub');
    expect(header.title).toBe('Prompts');
    expect(header.breadcrumbs).toEqual([]);
  });

  it('generates empty title for /prompt-hub/:id until data loads', () => {
    const header = generatePageHeader('/prompt-hub/abc-123');
    expect(header.title).toBe('');
    expect(header.breadcrumbs).toEqual([]);
  });

  it('generates correct header for /vault', () => {
    const header = generatePageHeader('/vault');
    expect(header.title).toBe('Vault');
    expect(header.breadcrumbs).toEqual([]);
  });

  it('generates empty title for /vault/:id until data loads', () => {
    const header = generatePageHeader('/vault/my-secret');
    expect(header.title).toBe('');
    expect(header.breadcrumbs).toEqual([]);
  });

  it('generates correct header for /settings/profile', () => {
    const header = generatePageHeader('/settings/profile');
    expect(header.title).toBe('User Profile');
    expect(header.breadcrumbs).toEqual([]);
  });

  it('generates a title for /settings/api-keys matching the sidebar label exactly', () => {
    const header = generatePageHeader('/settings/api-keys');
    expect(header.title).toBe('Api Keys');
    expect(header.breadcrumbs).toEqual([]);
  });

  it('generates breadcrumbs for /dashboards/board', () => {
    const header = generatePageHeader('/dashboards/board');
    expect(header.title).toBe('Board');
    expect(header.breadcrumbs).toContainEqual({ title: 'Dashboards', href: '/dashboards' });
  });

  it('generates breadcrumbs for /dashboards/explorer', () => {
    const header = generatePageHeader('/dashboards/explorer');
    expect(header.title).toBe('Explorer');
    expect(header.breadcrumbs).toContainEqual({ title: 'Dashboards', href: '/dashboards' });
  });

  it('generates breadcrumbs for /dashboards/widget', () => {
    const header = generatePageHeader('/dashboards/widget');
    expect(header.title).toBe('Widget');
    expect(header.breadcrumbs).toContainEqual({ title: 'Dashboards', href: '/dashboards' });
  });

  it('generates correct header for /openground', () => {
    const header = generatePageHeader('/openground');
    expect(header.title).toBe('Openground');
    expect(header.breadcrumbs).toEqual([]);
  });

  it('generates correct title for /openground/new', () => {
    const header = generatePageHeader('/openground/new');
    expect(typeof header.title).toBe('string');
    expect(header.breadcrumbs.length).toBeGreaterThan(0);
  });

  it('generates correct title for /openground/models', () => {
    const header = generatePageHeader('/openground/models');
    expect(typeof header.title).toBe('string');
    expect(header.breadcrumbs.length).toBeGreaterThan(0);
  });

  it('generates title for /openground/:id (non-special path)', () => {
    const header = generatePageHeader('/openground/run-123');
    expect(typeof header.title).toBe('string');
    expect(header.breadcrumbs.length).toBeGreaterThan(0);
  });

  it('generates correct header for /settings', () => {
    const header = generatePageHeader('/settings');
    expect(header.title).toBe('Settings');
    expect(header.breadcrumbs).toEqual([]);
  });

  it('generates breadcrumbs for /evaluations/settings', () => {
    const header = generatePageHeader('/evaluations/settings');
    expect(header.title).toBe('Evaluation Settings');
    expect(header.breadcrumbs).toContainEqual({ title: 'Evaluations', href: '/evaluations' });
    expect(header.breadcrumbs).toContainEqual({ title: 'Settings', href: '/evaluations/settings' });
  });

  it('generates breadcrumbs for /evaluations/evaluators/:id', () => {
    const header = generatePageHeader('/evaluations/evaluators/bias');
    expect(header.title).toBe('Evaluator');
    expect(header.breadcrumbs).toContainEqual({ title: 'Evaluations', href: '/evaluations' });
    expect(header.breadcrumbs).toContainEqual({ title: 'Evaluator', href: '/evaluations' });
  });

  it('generates breadcrumbs for /evaluations/types/:id', () => {
    const header = generatePageHeader('/evaluations/types/bias');
    expect(header.title).toBe('Evaluation Type');
    expect(header.breadcrumbs).toContainEqual({ title: 'Evaluations', href: '/evaluations' });
    expect(header.breadcrumbs).toContainEqual({
      title: 'Evaluators',
      href: '/evaluations?tab=evaluators',
    });
  });

  it('generates breadcrumbs for /organisation under Settings', () => {
    const header = generatePageHeader('/organisation');
    expect(header.title).toBe('Organisation');
    expect(header.breadcrumbs).toContainEqual({ title: 'Settings', href: '/settings' });
    expect(header.breadcrumbs).toContainEqual({ title: 'Organisation', href: '/organisation' });
  });

  it('generates breadcrumbs for /settings/database-config', () => {
    const header = generatePageHeader('/settings/database-config');
    expect(header.title).toBe('Database Config');
    expect(header.breadcrumbs).toContainEqual({ title: 'Settings', href: '/settings' });
  });

  it('generates a title for /fleet-hub matching the sidebar label exactly', () => {
    const header = generatePageHeader('/fleet-hub');
    expect(header.title).toBe('Fleet Hub');
    expect(header.breadcrumbs).toEqual([]);
  });

  it('generates empty title for /fleet-hub/:id until data loads', () => {
    const header = generatePageHeader('/fleet-hub/agent-1');
    expect(header.title).toBe('');
    expect(header.breadcrumbs).toEqual([]);
  });

  it('falls back gracefully for unknown routes', () => {
    const header = generatePageHeader('/some-unknown-route');
    expect(header.title).toBe('Some unknown route');
    expect(header.breadcrumbs).toEqual([]);
  });

  it('capitalizes first letter in fallback title', () => {
    const header = generatePageHeader('/my-feature');
    expect(header.title[0]).toBe(header.title[0].toUpperCase());
  });

  it('returns "Page" fallback title for root path with no segments', () => {
    const header = generatePageHeader('/');
    expect(header.title).toBe('Page');
    expect(header.breadcrumbs).toEqual([]);
  });

  it('generates empty title for /prompt-hub/:id without params', () => {
    const header = generatePageHeader('/prompt-hub/abc');
    expect(header.title).toBe('');
  });
});

describe('updatePageHeaderWithData', () => {
  const baseHeader = {
    title: 'Original Title',
    breadcrumbs: [{ title: 'Home', href: '/' }],
  };

  it('updates the title when provided', () => {
    const updated = updatePageHeaderWithData(baseHeader, { title: 'New Title' });
    expect(updated.title).toBe('New Title');
  });

  it('keeps the original title when no title provided', () => {
    const updated = updatePageHeaderWithData(baseHeader, {});
    expect(updated.title).toBe('Original Title');
  });

  it('adds description when provided', () => {
    const updated = updatePageHeaderWithData(baseHeader, {
      description: 'A description',
    });
    expect(updated.description).toBe('A description');
  });

  it('keeps original description when no description provided', () => {
    const headerWithDesc = { ...baseHeader, description: 'Old description' };
    const updated = updatePageHeaderWithData(headerWithDesc, {});
    expect(updated.description).toBe('Old description');
  });

  it('preserves breadcrumbs from the original header', () => {
    const updated = updatePageHeaderWithData(baseHeader, { title: 'New' });
    expect(updated.breadcrumbs).toEqual(baseHeader.breadcrumbs);
  });
});

describe('ROUTE_CONFIGS handlers', () => {
  it('invokes every route title/breadcrumb/description handler', () => {
    const { ROUTE_CONFIGS } = require('@/utils/breadcrumbs') as typeof import('@/utils/breadcrumbs');
    const params = { id: 'abc', userId: encodeURIComponent('a@b.com') };

    expect(ROUTE_CONFIGS.length).toBeGreaterThan(10);

    for (const config of ROUTE_CONFIGS) {
      expect(typeof config.getTitle('/sample', params)).toBe('string');
      const crumbs = config.getBreadcrumbs('/sample', params);
      expect(Array.isArray(crumbs)).toBe(true);
      if (config.getDescription) {
        expect(typeof config.getDescription('/sample', params)).toBe('string');
      }
    }
  });

  it('extracts coding-agents user id params', () => {
    const result = extractRouteParams(
      '/coding-agents/users/alice%40example.com',
      /^\/coding-agents\/users\/[^/]+$/
    );
    expect(result.userId).toBe('alice%40example.com');
  });

  it('falls back for unknown routes', () => {
    const header = generatePageHeader('/totally-unknown-page');
    expect(header.title).toBe('Totally unknown page');
    expect(header.breadcrumbs).toEqual([]);
  });
});
