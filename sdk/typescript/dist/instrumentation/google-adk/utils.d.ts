import { Span, SpanKind } from '@opentelemetry/api';
import { AsyncLocalStorage } from 'async_hooks';
/**
 * Prevents Runner.run_async from creating a second invoke_agent span
 * when called internally by Runner.run (mirrors Python _ADK_WORKFLOW_ACTIVE).
 */
export declare const adkWorkflowActive: AsyncLocalStorage<boolean>;
export declare function isAdkWorkflowActive(): boolean;
export declare const OPERATION_MAP: Record<string, string>;
export declare function getOperationType(endpoint: string): string;
export declare function getSpanKind(operationType: string): SpanKind;
export declare function generateSpanName(endpoint: string, instance: any): string;
/**
 * Drop-in replacement for ADK's tracer objects. Overrides
 * `startActiveSpan` to yield the current span instead of creating a new one,
 * letting OpenLIT own top-level spans while ADK's code still runs.
 */
export declare class PassthroughTracer {
    private _wrapped;
    constructor(wrapped: any);
    startActiveSpan(...args: any[]): any;
    startSpan(...args: any[]): any;
}
export declare function resolveModelString(modelObj: any): string | null;
export declare function extractModelName(instance: any): string;
export declare function resolveServerInfo(instance?: any, modelName?: string | null): [string, number, string];
export declare function setCommonSpanAttributes(span: Span, operationType: string): void;
export declare function captureInputMessages(span: Span, llmRequest: any, captureContent: boolean): void;
export declare function captureOutputMessages(span: Span, llmResponse: any, captureContent: boolean, finishReason?: string): void;
export declare function captureEventOutput(span: Span, event: any, captureContent: boolean): void;
export interface TokenUsage {
    inputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
    cachedTokens?: number;
    totalTokens?: number;
}
export declare function extractTokenUsage(llmResponse: any): TokenUsage;
export declare function enrichLlmSpan(span: Span, llmRequest: any, llmResponse: any, captureMessageContent: boolean): void;
export declare function enrichToolSpan(span: Span, tool: any, functionArgs: any, functionResponseEvent: any, captureMessageContent: boolean, error?: any): void;
export declare function enrichMergedToolSpan(span: Span, responseEventId: any, functionResponseEvent: any, captureMessageContent: boolean): void;
export declare function setRunnerAgentAttributes(span: Span, instance: any, endpoint: string): void;
export declare function setAgentAttributes(span: Span, instance: any): void;
export declare function processGoogleAdkResponse(span: Span, endpoint: string, instance: any, startTime: number, _captureMessageContent: boolean): void;
export declare function recordGoogleAdkMetrics(operationType: string, duration: number, requestModel: string, serverAddress: string, serverPort: number): void;
