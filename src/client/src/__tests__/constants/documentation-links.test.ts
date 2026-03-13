import DOCUMENTATION_LINKS from '@/constants/documentation-links';

describe('DOCUMENTATION_LINKS', () => {
  it('is an object', () => {
    expect(typeof DOCUMENTATION_LINKS).toBe('object');
    expect(DOCUMENTATION_LINKS).not.toBeNull();
  });

  it('has all expected keys', () => {
    const expectedKeys = [
      'promptHub',
      'openground',
      'vault',
      'multipleDb',
      'anonymousTelemetry',
      'apiReference',
      'promptHubApiReference',
      'vaultApiReference',
    ];
    expectedKeys.forEach((key) => {
      expect(DOCUMENTATION_LINKS).toHaveProperty(key);
    });
  });

  it('all values are non-empty strings', () => {
    Object.values(DOCUMENTATION_LINKS).forEach((value) => {
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
    });
  });

  it('all values are valid HTTPS URLs', () => {
    Object.values(DOCUMENTATION_LINKS).forEach((value) => {
      expect(value).toMatch(/^https:\/\//);
    });
  });

  it('promptHub points to the prompt-hub docs', () => {
    expect(DOCUMENTATION_LINKS.promptHub).toContain('prompt-hub');
  });

  it('openground points to the openground docs', () => {
    expect(DOCUMENTATION_LINKS.openground).toContain('openground');
  });

  it('vault points to the vault docs', () => {
    expect(DOCUMENTATION_LINKS.vault).toContain('vault');
  });

  it('apiReference points to the api-reference docs', () => {
    expect(DOCUMENTATION_LINKS.apiReference).toContain('api-reference');
  });
});
