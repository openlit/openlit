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

  it('calls console.log with multiple arguments wrapped in an array', () => {
    consoleLog('a', 'b', 'c');
    expect(consoleSpy).toHaveBeenCalledWith(['a', 'b', 'c']);
  });

  it('calls console.log once per invocation', () => {
    consoleLog('test');
    expect(consoleSpy).toHaveBeenCalledTimes(1);
  });
});
