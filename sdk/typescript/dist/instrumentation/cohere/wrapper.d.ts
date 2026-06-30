import { Span, Tracer } from '@opentelemetry/api';
import BaseWrapper from '../base-wrapper';
export default class CohereWrapper extends BaseWrapper {
    static aiSystem: string;
    static serverAddress: string;
    static serverPort: number;
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
    static _patchEmbed(tracer: Tracer): any;
    static _patchChat(tracer: Tracer): any;
    static _patchChatStream(tracer: Tracer): any;
    static _chat({ args, genAIEndpoint, response, span, }: {
        args: any[];
        genAIEndpoint: string;
        response: any;
        span: Span;
    }): Promise<any>;
    static _chatGenerator({ args, genAIEndpoint, response, span, }: {
        args: any[];
        genAIEndpoint: string;
        response: any;
        span: Span;
    }): AsyncGenerator<unknown, any, unknown>;
    static _chatCommonSetter({ args, genAIEndpoint, result, span, stream, ttft, tbt, }: {
        args: any[];
        genAIEndpoint: string;
        result: any;
        span: Span;
        stream?: boolean;
        ttft?: number;
        tbt?: number;
    }): Promise<{
        genAIEndpoint: string;
        model: any;
        user: any;
        cost: number;
        aiSystem: string;
    }>;
}
