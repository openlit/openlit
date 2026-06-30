import { Span, Tracer } from '@opentelemetry/api';
import BaseWrapper, { BaseSpanAttributes } from '../base-wrapper';
declare class TransformersWrapper extends BaseWrapper {
    static aiSystem: string;
    static serverAddress: string;
    static serverPort: number;
    /**
     * Stamp `openlit.agent.version_hash` (auto) and `gen_ai.agent.version`
     * (user override) on the span and return them so the caller can merge them
     * into the inference-event extras.
     */
    static _stampAgentVersion(span: Span, args: {
        systemInstructionsJson?: string | null;
        primaryModel?: string;
        temperature?: number | null;
        top_p?: number | null;
        max_tokens?: number | null;
    }): Record<string, string>;
    /**
     * Patch a Pipeline subclass `_call` (the method invoked when the pipeline
     * object is used as a function). `this` is the pipeline instance.
     * args[0] = inputs, args[1] = generation options.
     */
    static _patchPipelineCall(tracer: Tracer, className: string, sdkVersion?: string): any;
    /**
     * Patch the `pipeline()` factory as a fallback when no Pipeline subclass
     * prototype is exported. Wraps the returned callable so each invocation
     * emits a span. The original callable is invoked directly (not via the
     * wrapper) so we never lose its prototype behavior.
     */
    static _patchPipelineFactory(tracer: Tracer, sdkVersion?: string): any;
    /**
     * Synchronous attribute setter shared by the class- and factory-patch paths.
     * Returns the metric params so the caller can record metrics in `finally`.
     */
    static _handleResponse({ instance, args, response, span, requestModel, task, operation, genAIEndpoint, ttft, sdkVersion, }: {
        instance: any;
        args: any[];
        response: any;
        span: Span;
        requestModel: string;
        task: string;
        operation: string;
        genAIEndpoint: string;
        ttft: number;
        sdkVersion?: string;
    }): BaseSpanAttributes;
}
export default TransformersWrapper;
