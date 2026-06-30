import { Span, Tracer } from '@opentelemetry/api';
import BaseWrapper from '../base-wrapper';
declare class VertexAIWrapper extends BaseWrapper {
    static aiSystem: string;
    static serverPort: number;
    static _extractModelName(instance: any): string;
    static _stampAgentVersion(span: Span, args: {
        systemInstructionsJson?: string;
        toolDefinitionsJson?: string;
        primaryModel?: string;
        temperature?: number | null;
        top_p?: number | null;
        max_tokens?: number | null;
    }): Record<string, string>;
    static _buildPatcher({ genAIEndpoint, isStream, isChatSession, tracer, }: {
        genAIEndpoint: string;
        isStream: boolean;
        isChatSession: boolean;
        tracer: Tracer;
    }): (originalMethod: (...args: any[]) => any) => (...args: any[]) => Promise<any>;
    static _patchGenerateContent(tracer: Tracer): any;
    static _patchGenerateContentStream(tracer: Tracer): any;
    static _patchSendMessage(tracer: Tracer): any;
    static _patchSendMessageStream(tracer: Tracer): any;
    static _processResponse({ args, genAIEndpoint, instance, response, span, requestModel, serverAddress, isChatSession, }: {
        args: any[];
        genAIEndpoint: string;
        instance?: any;
        response: any;
        span: Span;
        requestModel: string;
        serverAddress: string;
        isChatSession?: boolean;
    }): Promise<any>;
    static _streamGenerator({ args, genAIEndpoint, instance, stream, span, requestModel, serverAddress, isChatSession, }: {
        args: any[];
        genAIEndpoint: string;
        instance?: any;
        stream: any;
        span: Span;
        requestModel: string;
        serverAddress: string;
        isChatSession?: boolean;
    }): AsyncGenerator<unknown, any, unknown>;
    static _commonSetter({ args, genAIEndpoint, instance, result, span, requestModel, serverAddress, ttft, tbt, isStream, isChatSession, }: {
        args: any[];
        genAIEndpoint: string;
        instance?: any;
        result: any;
        span: Span;
        requestModel: string;
        serverAddress: string;
        ttft?: number;
        tbt?: number;
        isStream?: boolean;
        isChatSession?: boolean;
    }): Promise<{
        genAIEndpoint: string;
        model: string;
        user: undefined;
        cost: number;
        aiSystem: string;
        serverAddress: string;
        serverPort: number;
    }>;
}
export default VertexAIWrapper;
