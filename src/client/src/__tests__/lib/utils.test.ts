import { cn } from '@/lib/utils';

describe('cn (className utility)', () => {
  it('merges class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });

  it('handles conditional classes', () => {
    expect(cn('base', false && 'hidden', 'visible')).toBe('base visible');
  });

  it('resolves tailwind conflicts (later class wins)', () => {
    // tailwind-merge: p-2 overrides p-4 when applied later
    expect(cn('p-4', 'p-2')).toBe('p-2');
  });

  it('handles undefined and null values', () => {
    expect(cn('foo', undefined, null, 'bar')).toBe('foo bar');
  });

  it('handles object syntax', () => {
    expect(cn({ 'text-red-500': true, 'text-blue-500': false })).toBe(
      'text-red-500'
    );
  });

  it('handles array syntax', () => {
    expect(cn(['foo', 'bar'])).toBe('foo bar');
  });

  it('returns empty string when no classes provided', () => {
    expect(cn()).toBe('');
  });

  it('merges duplicate tailwind utilities correctly', () => {
    expect(cn('mt-2 mt-4')).toBe('mt-4');
  });
});
