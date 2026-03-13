import { noop } from '@/utils/noop';

describe('noop', () => {
  it('is a function', () => {
    expect(typeof noop).toBe('function');
  });

  it('returns undefined', () => {
    expect(noop()).toBeUndefined();
  });

  it('does not throw when called', () => {
    expect(() => noop()).not.toThrow();
  });

  it('accepts any arguments without error', () => {
    expect(() => (noop as any)(1, 'two', { three: 3 })).not.toThrow();
  });
});
