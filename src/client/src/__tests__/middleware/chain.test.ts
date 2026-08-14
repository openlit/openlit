import { chain } from '@/middleware/chain';
import { NextResponse } from 'next/server';

// Mock next/server
jest.mock('next/server', () => ({
  NextResponse: {
    next: jest.fn(),
  },
}));

describe('chain', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns NextResponse.next when given an empty array', () => {
    const result = chain([]);
    expect(result).toBe(NextResponse.next);
  });

  it('calls the first middleware factory with the next handler', () => {
    const innerHandler = jest.fn();
    const factory = jest.fn(() => innerHandler);

    const result = chain([factory]);

    expect(factory).toHaveBeenCalledWith(NextResponse.next);
    expect(result).toBe(innerHandler);
  });

  it('chains two middleware factories in order', () => {
    const handler1 = jest.fn();
    const handler2 = jest.fn();
    const factory1 = jest.fn(() => handler1);
    const factory2 = jest.fn(() => handler2);

    const result = chain([factory1, factory2]);

    // factory2 is called first (it wraps NextResponse.next)
    expect(factory2).toHaveBeenCalledWith(NextResponse.next);
    // factory1 is called with factory2's result
    expect(factory1).toHaveBeenCalledWith(handler2);
    // The outermost handler is what chain returns
    expect(result).toBe(handler1);
  });

  it('chains three middleware factories in order', () => {
    const handlers = [jest.fn(), jest.fn(), jest.fn()];
    const factories = handlers.map((h) => jest.fn(() => h));

    const result = chain(factories);

    // Innermost factory wraps NextResponse.next
    expect(factories[2]).toHaveBeenCalledWith(NextResponse.next);
    // Middle factory wraps innermost handler
    expect(factories[1]).toHaveBeenCalledWith(handlers[2]);
    // Outer factory wraps middle handler
    expect(factories[0]).toHaveBeenCalledWith(handlers[1]);
    // Result is outermost handler
    expect(result).toBe(handlers[0]);
  });
});
