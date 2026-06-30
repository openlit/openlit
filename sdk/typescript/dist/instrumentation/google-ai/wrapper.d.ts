import { Span, Tracer } from '@opentelemetry/api';
import BaseWrapper from '../base-wrapper';
declare class GoogleAIWrapper extends BaseWrapper {
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
    static _patchGenerateContent(tracer: Tracer): any;
    static _generateContent({ args, genAIEndpoint, response, span, requestModel, }: {
        args: any[];
        genAIEndpoint: string;
        response: any;
        span: Span;
        requestModel: string;
    }): Promise<any>;
    static _generateContentStreamGenerator({ args, genAIEndpoint, response, span, requestModel, }: {
        args: any[];
        genAIEndpoint: string;
        response: any;
        span: Span;
        requestModel: string;
    }): AsyncGenerator<unknown, any, unknown>;
    static _generateContentCommonSetter({ args, genAIEndpoint, result, span, requestModel, ttft, tbt, isStream, }: {
        args: any[];
        genAIEndpoint: string;
        result: any;
        span: Span;
        requestModel: string;
        ttft?: number;
        tbt?: number;
        isStream?: boolean;
    }): Promise<{
        genAIEndpoint: string;
        model: string;
        user: undefined;
        cost: number;
        aiSystem: string;
    }>;
}
export default GoogleAIWrapper;
