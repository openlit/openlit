import { throwIfError } from '@/utils/error';

describe('throwIfError', () => {
  it('throws an Error with the given message when condition is true', () => {
    expect(() => throwIfError(true, 'test error')).toThrow('test error');
  });

  it('throws an instance of Error', () => {
    expect(() => throwIfError(true, 'boom')).toThrow(Error);
  });

  it('does not throw when condition is false', () => {
    expect(() => throwIfError(false, 'test error')).not.toThrow();
  });

  it('does not throw for various falsy conditions', () => {
    expect(() => throwIfError(false, 'msg')).not.toThrow();
  });
});
