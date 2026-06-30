import { Span, Tracer } from '@opentelemetry/api';
import BaseWrapper, { BaseSpanAttributes } from '../base-wrapper';
declare class ElevenLabsWrapper extends BaseWrapper {
    static aiSystem: string;
    static serverAddress: string;
    static serverPort: number;
    static _parseAudioArgs(args: any[]): {
        voiceId: string;
        options: Record<string, any>;
        requestModel: string;
        text: string;
        voiceSettings: unknown;
        outputFormat: string;
    };
    static _patchConvert(tracer: Tracer, methodName: string, sdkVersion?: string): any;
    static _patchStream(tracer: Tracer, methodName: string, sdkVersion?: string): any;
    static _streamGenerator({ args, genAIEndpoint, response, span, sdkVersion, }: {
        args: any[];
        genAIEndpoint: string;
        response: any;
        span: Span;
        sdkVersion?: string;
    }): AsyncGenerator<unknown, any, unknown>;
    static _commonAudioSetter({ args, genAIEndpoint, span, ttft, tbt, isStream, sdkVersion, }: {
        args: any[];
        genAIEndpoint: string;
        span: Span;
        ttft?: number;
        tbt?: number;
        isStream?: boolean;
        sdkVersion?: string;
    }): BaseSpanAttributes;
}
export default ElevenLabsWrapper;
