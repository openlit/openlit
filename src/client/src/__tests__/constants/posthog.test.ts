import { POSTHOG_API_KEY, POSTHOG_API_HOST } from '@/constants/posthog';

describe('posthog constants', () => {
  it('exports a non-empty POSTHOG_API_KEY', () => {
    expect(typeof POSTHOG_API_KEY).toBe('string');
    expect(POSTHOG_API_KEY.length).toBeGreaterThan(0);
  });

  it('exports a valid POSTHOG_API_HOST URL', () => {
    expect(typeof POSTHOG_API_HOST).toBe('string');
    expect(POSTHOG_API_HOST).toContain('posthog.com');
  });
});
