import { Span, Tracer } from '@opentelemetry/api';
import BaseWrapper from '../base-wrapper';
declare class VercelAIWrapper extends BaseWrapper {
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
    static _patchGenerateText(tracer: Tracer): any;
    static _patchStreamText(tracer: Tracer): any;
    static _patchGenerateObject(tracer: Tracer): any;
    static _patchEmbed(tracer: Tracer): any;
    static _chatComplete({ args, genAIEndpoint, response, span, outputType, resultOverride, }: {
        args: any[];
        genAIEndpoint: string;
        response: any;
        span: Span;
        outputType: string;
        resultOverride?: any;
    }): Promise<any>;
    static _chatCommonSetter({ args, genAIEndpoint, result, span, isStream, outputType, ttft, tbt, }: {
        args: any[];
        genAIEndpoint: string;
        result: any;
        span: Span;
        isStream: boolean;
        outputType: string;
        ttft?: number;
        tbt?: number;
    }): Promise<{
        genAIEndpoint: string;
        model: any;
        cost: number;
        aiSystem: string;
        serverAddress: string;
        serverPort: number;
    }>;
}
export default VercelAIWrapper;
