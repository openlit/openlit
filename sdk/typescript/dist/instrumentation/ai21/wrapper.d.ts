import { Span, Tracer } from '@opentelemetry/api';
import BaseWrapper from '../base-wrapper';
declare class AI21Wrapper extends BaseWrapper {
    static aiSystem: string;
    static serverAddress: string;
    static serverPort: number;
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
    static _patchConversationalRagCreate(tracer: Tracer): any;
    static _chatRag({ args, genAIEndpoint, response, span, }: {
        args: any[];
        genAIEndpoint: string;
        response: any;
        span: Span;
    }): Promise<any>;
    static _chatRagCommonSetter({ args, genAIEndpoint, result, span, }: {
        args: any[];
        genAIEndpoint: string;
        result: any;
        span: Span;
    }): Promise<{
        genAIEndpoint: string;
        model: any;
        user: any;
        cost: number;
        aiSystem: string;
    }>;
}
export default AI21Wrapper;
