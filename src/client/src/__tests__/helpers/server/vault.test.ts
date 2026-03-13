import { verifySecretInput, normalizeSecretDataForSDK } from '@/helpers/server/vault';

describe('verifySecretInput', () => {
  it('returns failure when key is an empty string', () => {
    const result = verifySecretInput({ key: '' });
    expect(result.success).toBe(false);
    expect(result.err).toBeTruthy();
  });

  it('returns success when key is present', () => {
    const result = verifySecretInput({ key: 'MY_SECRET' });
    expect(result.success).toBe(true);
    expect(result.err).toBeUndefined();
  });

  it('returns success when both key and value are provided', () => {
    const result = verifySecretInput({ key: 'API_KEY', value: 'abc123' });
    expect(result.success).toBe(true);
  });

  it('returns success when key is provided without value', () => {
    const result = verifySecretInput({ key: 'MY_KEY' });
    expect(result.success).toBe(true);
  });
});

describe('normalizeSecretDataForSDK', () => {
  it('converts an array of secrets to a key-value object', () => {
    const secrets = [
      { key: 'API_KEY', value: 'abc123' },
      { key: 'DB_URL', value: 'postgres://localhost/db' },
    ];

    const result = normalizeSecretDataForSDK(secrets);
    expect(result).toEqual({
      API_KEY: 'abc123',
      DB_URL: 'postgres://localhost/db',
    });
  });

  it('returns an empty object for an empty array', () => {
    expect(normalizeSecretDataForSDK([])).toEqual({});
  });

  it('handles a single secret', () => {
    const result = normalizeSecretDataForSDK([{ key: 'TOKEN', value: 'xyz' }]);
    expect(result).toEqual({ TOKEN: 'xyz' });
  });

  it('later duplicates overwrite earlier ones', () => {
    const secrets = [
      { key: 'KEY', value: 'first' },
      { key: 'KEY', value: 'second' },
    ];
    const result = normalizeSecretDataForSDK(secrets);
    expect(result.KEY).toBe('second');
  });
});
