import { Span, Tracer } from '@opentelemetry/api';
import BaseWrapper, { BaseSpanAttributes } from '../base-wrapper';
declare class AzureAIInferenceWrapper extends BaseWrapper {
    static aiSystem: string;
    static defaultServerAddress: string;
    static defaultServerPort: number;
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
    /**
     * Extracts server address and port from an endpoint URL string.
     */
    static parseEndpoint(endpoint: string): {
        serverAddress: string;
        serverPort: number;
    };
    static _patchChatComplete(tracer: Tracer, serverAddress: string, serverPort: number): any;
    static _chatCompletion({ body, genAIEndpoint, httpResponse, span, serverAddress, serverPort, }: {
        body: any;
        genAIEndpoint: string;
        httpResponse: any;
        span: Span;
        serverAddress: string;
        serverPort: number;
    }): Promise<any>;
    /**
     * Wraps an SSE body stream (Node.js IncomingMessage / ReadableStream) to
     * aggregate telemetry while passing through chunks to the caller.
     * Returns an async-iterable that yields the raw SSE buffers/strings so
     * downstream consumers (e.g. createSseStream) keep working.
     */
    static _wrapSseStream(body: any, requestBody: any, genAIEndpoint: string, span: Span, serverAddress: string, serverPort: number): any;
    static _chatCompletionCommonSetter({ body, genAIEndpoint, result, span, serverAddress, serverPort, ttft, tbt, }: {
        body: any;
        genAIEndpoint: string;
        result: any;
        span: Span;
        serverAddress: string;
        serverPort: number;
        ttft?: number;
        tbt?: number;
    }): BaseSpanAttributes;
    static _patchEmbeddings(tracer: Tracer, serverAddress: string, serverPort: number): any;
}
export default AzureAIInferenceWrapper;
