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

  it('generates header with breadcrumbs for individual dashboard view', () => {
    const header = generatePageHeader(
      '/d/123e4567-e89b-12d3-a456-426614174000'
    );
    expect(header.title).toBe('Dashboard');
    expect(header.breadcrumbs).toEqual([
      { title: 'Dashboards', href: '/dashboards' },
    ]);
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
    expect(header.title).toBe('Prompt Hub');
    expect(header.breadcrumbs).toEqual([]);
  });

  it('generates breadcrumbs for /prompt-hub/:id', () => {
    const header = generatePageHeader('/prompt-hub/abc-123');
    expect(header.title).toBe('Prompt Details');
    expect(header.breadcrumbs).toEqual([
      { title: 'Prompt Hub', href: '/prompt-hub' },
    ]);
  });

  it('generates correct header for /vault', () => {
    const header = generatePageHeader('/vault');
    expect(header.title).toBe('Vault');
    expect(header.breadcrumbs).toEqual([]);
  });

  it('generates breadcrumbs for /vault/:id', () => {
    const header = generatePageHeader('/vault/my-secret');
    expect(header.title).toBe('Vault Item');
    expect(header.breadcrumbs).toEqual([
      { title: 'Vault', href: '/vault' },
    ]);
  });

  it('generates correct header for /settings/profile', () => {
    const header = generatePageHeader('/settings/profile');
    expect(header.title).toBe('User Profile');
    expect(header.breadcrumbs).toEqual([
      { title: 'Settings', href: '/settings' },
    ]);
  });

  it('generates correct header for /settings/api-keys', () => {
    const header = generatePageHeader('/settings/api-keys');
    expect(header.title).toBe('API Keys');
    expect(header.breadcrumbs).toContainEqual({
      title: 'Settings',
      href: '/settings',
    });
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
