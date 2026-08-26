import { consoleLog } from '@/utils/log';

describe('consoleLog', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('calls console.log', () => {
    consoleLog('hello');
    expect(consoleSpy).toHaveBeenCalled();
  });

  it('serializes multiple arguments as a JSON array string', () => {
    consoleLog('a', 'b', 'c');
    expect(consoleSpy).toHaveBeenCalledWith('["a","b","c"]');
  });

  it('calls console.log once per invocation', () => {
    consoleLog('test');
    expect(consoleSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back when arguments contain circular references', () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(() => consoleLog(circular)).not.toThrow();
    expect(consoleSpy).toHaveBeenCalled();
  });
});
