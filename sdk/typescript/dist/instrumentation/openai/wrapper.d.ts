import { Span, Tracer } from '@opentelemetry/api';
import BaseWrapper from '../base-wrapper';
declare class OpenAIWrapper extends BaseWrapper {
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
    static _patchChatCompletionCreate(tracer: Tracer): any;
    static _chatCompletion({ args, genAIEndpoint, response, span, }: {
        args: any[];
        genAIEndpoint: string;
        response: any;
        span: Span;
    }): Promise<any>;
    static _chatCompletionGenerator({ args, genAIEndpoint, response, span, }: {
        args: any[];
        genAIEndpoint: string;
        response: any;
        span: Span;
    }): AsyncGenerator<unknown, any, unknown>;
    static _chatCompletionCommonSetter({ args, genAIEndpoint, result, span, ttft, tbt, }: {
        args: any[];
        genAIEndpoint: string;
        result: any;
        span: Span;
        ttft?: number;
        tbt?: number;
    }): Promise<{
        genAIEndpoint: string;
        model: any;
        user: any;
        cost: number;
        aiSystem: string;
    }>;
    static _patchEmbedding(tracer: Tracer): any;
    static _patchFineTune(tracer: Tracer): any;
    static _patchImageGenerate(tracer: Tracer): any;
    static _patchImageVariation(tracer: Tracer): any;
    static _patchAudioCreate(tracer: Tracer): any;
    static _patchResponsesCreate(tracer: Tracer): any;
    static _responsesComplete({ args, genAIEndpoint, response, span, }: {
        args: any[];
        genAIEndpoint: string;
        response: any;
        span: Span;
    }): Promise<any>;
    static _responsesGenerator({ args, genAIEndpoint, response, span, }: {
        args: any[];
        genAIEndpoint: string;
        response: any;
        span: Span;
    }): AsyncGenerator<unknown, any, unknown>;
    static _responsesCommonSetter({ args, genAIEndpoint, result, span, ttft, tbt, }: {
        args: any[];
        genAIEndpoint: string;
        result: any;
        span: Span;
        ttft?: number;
        tbt?: number;
    }): Promise<{
        genAIEndpoint: string;
        model: any;
        user: string;
        cost: number;
        aiSystem: string;
    }>;
}
export default OpenAIWrapper;
