import { Span, Tracer } from '@opentelemetry/api';
import BaseWrapper from '../base-wrapper';
export default class AnthropicWrapper extends BaseWrapper {
    static aiSystem: string;
    static serverAddress: string;
    static serverPort: number;
    static _patchMessageCreate(tracer: Tracer): any;
    static _messageCreate({ args, genAIEndpoint, response, span, }: {
        args: any[];
        genAIEndpoint: string;
        response: any;
        span: Span;
    }): Promise<any>;
    static _messageCreateGenerator({ args, genAIEndpoint, response, span, }: {
        args: any[];
        genAIEndpoint: string;
        response: any;
        span: Span;
    }): AsyncGenerator<unknown, any, unknown>;
    static _messageCreateCommonSetter({ args, genAIEndpoint, result, span, ttft, tbt, }: {
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
}
