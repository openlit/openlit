import asaw from '@/utils/asaw';

describe('asaw', () => {
  it('returns [null, result] on successful promise', async () => {
    const result = await asaw(Promise.resolve(42));
    expect(result).toEqual([null, 42]);
  });

  it('returns [errorString] on rejected promise', async () => {
    const result = await asaw(Promise.reject(new Error('Something went wrong')));
    expect(result).toEqual(['Error: Something went wrong']);
  });

  it('handles resolved object values', async () => {
    const data = { name: 'Alice', age: 30 };
    const result = await asaw(Promise.resolve(data));
    expect(result).toEqual([null, data]);
  });

  it('handles resolved array values', async () => {
    const result = await asaw(Promise.resolve([1, 2, 3]));
    expect(result).toEqual([null, [1, 2, 3]]);
  });

  it('handles resolved null values', async () => {
    const result = await asaw(Promise.resolve(null));
    expect(result).toEqual([null, null]);
  });

  it('stringifies the error on rejection', async () => {
    const customError = new TypeError('type mismatch');
    const result = await asaw(Promise.reject(customError));
    expect(result[0]).toBe('TypeError: type mismatch');
  });
});
