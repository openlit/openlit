/**
 * OpenLIT LlamaIndex Wrapper
 *
 * Mirrors Python SDK: sdk/python/src/openlit/instrumentation/llamaindex/
 * Uses the same OPERATION_MAP and span semantics as the Python implementation.
 *
 * LLM operations get full provider-style telemetry (attributes, events, metrics).
 * Framework operations (query engine, retriever, index, etc.) get framework-level spans.
 */
import { Tracer, Span } from '@opentelemetry/api';
export default class LlamaIndexWrapper {
    static aiSystem: string;
    /**
     * Stamp `openlit.agent.version_hash` (auto) and `gen_ai.agent.version`
     * (user override, if set) on the span and return the same attributes so
     * the caller can merge them into the inference event extras.
     */
    static _stampAgentVersion(span: Span, args: {
        systemInstructionsJson?: string;
        toolDefinitionsJson?: string;
        primaryModel?: string;
        temperature?: number | null;
        top_p?: number | null;
        max_tokens?: number | null;
    }): Record<string, string>;
    private static _extractModel;
    private static _extractServerInfo;
    static _patchLLMChat(tracer: Tracer): any;
    static _patchLLMComplete(tracer: Tracer): any;
    private static _processLLMResponse;
    static _patchQueryEngineQuery(tracer: Tracer): any;
    static _patchChatEngineChat(tracer: Tracer): any;
    static _patchRetrieverRetrieve(tracer: Tracer): any;
    static _patchEmbedding(tracer: Tracer, endpoint?: string): any;
    static _patchFrameworkMethod(tracer: Tracer, endpoint: string): any;
}
