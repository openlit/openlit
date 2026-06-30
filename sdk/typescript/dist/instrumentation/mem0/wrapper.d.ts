import { Tracer } from '@opentelemetry/api';
/**
 * Wrapper for mem0 memory-layer operations. mem0 exposes the same method surface on
 * the hosted `MemoryClient` (`mem0ai`) and the self-hosted `Memory` (`mem0ai/oss`):
 * add / search / get / getAll / update / delete / deleteAll / history. Every method
 * returns a Promise, so a single async wrapper handles them all. The emitted spans
 * mirror the Python reference (sdk/python/src/openlit/instrumentation/mem0): one
 * CLIENT span per call named `memory <op>`, with `gen_ai.*` attributes. No tokens,
 * model, cost, or metrics are involved (matching Python) so this does not use the
 * chat-oriented BaseWrapper.
 */
declare class Mem0Wrapper {
    static aiSystem: string;
    /**
     * Returns a wrapper (over an original Promise-returning method) that emits one
     * `memory <op>` CLIENT span. `spanName` is the Python endpoint string, e.g.
     * `memory add` or `memory get_all`.
     */
    static _patchMemoryOperation(tracer: Tracer, spanName: string, version?: string): any;
    /** Sets every non-content attribute (core + scope + memory + operation + response). */
    static _setSpanAttributes(span: any, spanName: string, args: any[], response?: any, sdkVersion?: string): void;
    private static _setOperationAttributes;
    private static _setResponseAttributes;
    /** Captures input (add) / output (search) content when capture is enabled. */
    static _setContentAttributes(span: any, spanName: string, args: any[], response: any): void;
    /**
     * Returns the options/config object for an operation, accounting for the fact that
     * its argument position differs by method: add/search take it as the 2nd arg, while
     * getAll/deleteAll take it as the 1st. get/update/history take a positional id and
     * carry no scope config.
     */
    private static _extractConfig;
    private static _scopeValue;
    private static _hasMessages;
    private static _safeStringify;
}
export default Mem0Wrapper;
