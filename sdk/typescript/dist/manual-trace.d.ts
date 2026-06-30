import { Span } from '@opentelemetry/api';
/**
 * Wrapper for an OpenTelemetry span with helpers to set result and metadata.
 * Mirrors Python's TracedSpan — the span lifecycle is managed by startTrace() /
 * trace(), so you do not call end() yourself (like Python's `with` block).
 */
export declare class TracedSpan {
    private readonly _span;
    constructor(span: Span);
    /** Record the AI output or function return value on the span. */
    setResult(result: string): void;
    /** Stamp arbitrary key/value attributes onto the span. */
    setMetadata(metadata: Record<string, string | number | boolean>): void;
}
/**
 * Start a named CLIENT span scoped to a callback — the TypeScript equivalent of
 * Python's `with start_trace(name) as span:`.
 *
 * The span is active for the duration of `fn`, so child LLM spans nest correctly.
 *
 * @example
 *   const answer = await openlit.startTrace('my-operation', async (span) => {
 *     const result = await doWork();
 *     span.setResult(String(result));
 *     return result;
 *   });
 */
export declare function startTrace<T>(name: string, fn: (span: TracedSpan) => T | Promise<T>): T | Promise<T>;
/**
 * Wrap a function call in a CLIENT span — the TypeScript equivalent of
 * Python's `@openlit.trace` decorator.
 *
 * @example
 *   const answer = await openlit.trace('my-chain', async (span) => {
 *     const result = await chain.invoke({ question });
 *     span.setResult(result.content);
 *     return result;
 *   });
 */
export declare function trace<T>(name: string, fn: (span: TracedSpan) => T | Promise<T>): T | Promise<T>;
