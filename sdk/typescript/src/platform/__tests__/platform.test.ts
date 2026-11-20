import { createHash } from 'crypto';
import { sha1Hex } from '../sha1';
import { sha1Hex as nodeSha1Hex } from '../index';

describe('sha1Hex', () => {
  it.each(['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'héllo wörld 🌍', 'x'.repeat(1000)])(
    'matches node:crypto for %j',
    (text) => {
      const expected = createHash('sha1').update(text).digest('hex');
      expect(sha1Hex(text)).toBe(expected);
      expect(nodeSha1Hex(text)).toBe(expected);
    }
  );
});

describe('edge context stores', () => {
  const load = () => {
    let edge: typeof import('../index.edge');
    jest.isolateModules(() => {
      edge = require('../index.edge');
    });
    return edge!;
  };

  it('uses a global AsyncLocalStorage when the runtime has one', async () => {
    const { AsyncLocalStorage } = require('async_hooks');
    (globalThis as any).AsyncLocalStorage = AsyncLocalStorage;
    try {
      const { createContextStore, hasAsyncContext } = load();
      const store = createContextStore<string>();
      expect(hasAsyncContext()).toBe(true);
      await store.run('a', async () => {
        await Promise.resolve();
        expect(store.getStore()).toBe('a');
      });
    } finally {
      delete (globalThis as any).AsyncLocalStorage;
    }
  });

  it('falls back to a synchronous store that restores the previous value', () => {
    const { getBuiltinModule } = process as any;
    (process as any).getBuiltinModule = undefined;
    try {
      const { createContextStore, hasAsyncContext } = load();
      const store = createContextStore<string>();
      expect(hasAsyncContext()).toBe(false);
      store.run('outer', () => {
        store.run('inner', () => expect(store.getStore()).toBe('inner'));
        expect(store.getStore()).toBe('outer');
      });
      expect(store.getStore()).toBeUndefined();
      expect(() => store.run('x', () => { throw new Error('boom'); })).toThrow('boom');
      expect(store.getStore()).toBeUndefined();
    } finally {
      (process as any).getBuiltinModule = getBuiltinModule;
    }
  });

  it('never holds enterWith values in the synchronous store', () => {
    const { getBuiltinModule } = process as any;
    (process as any).getBuiltinModule = undefined;
    try {
      const store = load().createContextStore<string>();
      store.enterWith('tenant-a');
      expect(store.getStore()).toBeUndefined();
    } finally {
      (process as any).getBuiltinModule = getBuiltinModule;
    }
  });

  it('survives a runtime whose enterWith throws', () => {
    class ThrowingStorage {
      enterWith() {
        throw new Error('enterWith() is not implemented');
      }
    }
    (globalThis as any).AsyncLocalStorage = ThrowingStorage;
    try {
      const store = load().createContextStore<string>();
      expect(() => store.enterWith('x')).not.toThrow();
    } finally {
      delete (globalThis as any).AsyncLocalStorage;
    }
  });

  it('estimates tokens without tiktoken', () => {
    expect(load().countTokens('12345678', 'any')).toBe(2);
  });
});
