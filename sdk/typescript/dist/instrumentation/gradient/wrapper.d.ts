import { Span, Tracer } from '@opentelemetry/api';
import BaseWrapper from '../base-wrapper';
import { GradientEndpointKind } from './utils';
type ChatPatchOptions = {
    operationName: string;
    endpointKind: GradientEndpointKind;
    genAIEndpoint: string;
    apiType: string;
    isAgent?: boolean;
};
declare class GradientWrapper extends BaseWrapper {
    static aiSystem: string;
    static _patchChatCompletionCreate(tracer: Tracer): any;
    static _patchAgentChatCompletionCreate(tracer: Tracer): any;
    static _buildChatPatch(tracer: Tracer, options: ChatPatchOptions): any;
    static _patchImageGenerate(tracer: Tracer): any;
    static _chatCompletion({ args, genAIEndpoint, response, span, serverAddress, serverPort, operationName, apiType, }: {
        args: any[];
        genAIEndpoint: string;
        response: any;
        span: Span;
        serverAddress: string;
        serverPort: number;
        operationName: string;
        apiType: string;
    }): Promise<any>;
    static _chatCompletionGenerator({ args, genAIEndpoint, response, span, serverAddress, serverPort, operationName, apiType, }: {
        args: any[];
        genAIEndpoint: string;
        response: any;
        span: Span;
        serverAddress: string;
        serverPort: number;
        operationName: string;
        apiType: string;
    }): AsyncGenerator<unknown, any, unknown>;
    static _imageGenerateCommonSetter({ args, genAIEndpoint, response, span, serverAddress, serverPort, }: {
        args: any[];
        genAIEndpoint: string;
        response: any;
        span: Span;
        serverAddress: string;
        serverPort: number;
    }): {
        genAIEndpoint: string;
        model: any;
        user: any;
        cost: number;
        aiSystem: string;
        serverAddress: string;
        serverPort: number;
    };
    static _chatCompletionCommonSetter({ args, genAIEndpoint, result, span, ttft, tbt, serverAddress, serverPort, operationName, apiType, reasoningText, }: {
        args: any[];
        genAIEndpoint: string;
        result: any;
        span: Span;
        ttft?: number;
        tbt?: number;
        serverAddress: string;
        serverPort: number;
        operationName?: string;
        apiType?: string;
        reasoningText?: string;
    }): Promise<{
        genAIEndpoint: string;
        model: any;
        user: any;
        cost: number;
        aiSystem: string;
        serverAddress: string;
        serverPort: number;
    }>;
    static _buildOutputMessages(text: string, finishReason: string, toolCalls?: any[], reasoning?: string): string;
}
export default GradientWrapper;
