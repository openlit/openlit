import { Span, Tracer } from '@opentelemetry/api';
import BaseWrapper, { BaseSpanAttributes } from '../base-wrapper';
declare class BedrockWrapper extends BaseWrapper {
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
    static _patchSend(tracer: Tracer): any;
    static _handleConverseCommand(tracer: Tracer, originalMethod: any, instance: any, args: any[]): Promise<any>;
    static _converseComplete({ input, genAIEndpoint, response, span, modelId, }: {
        input: any;
        genAIEndpoint: string;
        response: any;
        span: Span;
        modelId: string;
    }): Promise<any>;
    static _handleConverseStreamCommand(tracer: Tracer, originalMethod: any, instance: any, args: any[]): Promise<any>;
    static _converseCommonSetter({ input, genAIEndpoint, result, span, modelId, isStream, ttft, tbt, }: {
        input: any;
        genAIEndpoint: string;
        result: any;
        span: Span;
        modelId: string;
        isStream: boolean;
        ttft?: number;
        tbt?: number;
    }): BaseSpanAttributes;
}
export default BedrockWrapper;
