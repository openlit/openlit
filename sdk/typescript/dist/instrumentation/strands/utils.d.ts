/**
 * Strands Agents instrumentation utilities.
 *
 * Provides model-to-provider mapping, server address inference, content
 * extraction from Strands native span events, inference event emission,
 * and metrics recording.
 *
 * Mirrors: sdk/python/src/openlit/instrumentation/strands/utils.py
 */
export declare function inferServerAddress(modelName: string): [string, number];
export declare function inferProviderName(modelName: string): string;
/**
 * Extract message content from Strands span events.
 *
 * Handles both legacy named events (gen_ai.user.message, gen_ai.choice, etc.)
 * and the gen_ai.client.inference.operation.details event convention.
 *
 * Returns [inputMessages, outputMessages, systemInstructions, toolDefinitions].
 */
export declare function extractContentFromEvents(span: any, operation: string): [any[], any[], string | null, string | null];
export declare function truncateContent(content: string): string;
export declare function truncateMessageContent(messages: any[]): void;
export declare function recordStrandsMetrics(operation: string, duration: number, modelName: string, serverAddress: string, serverPort: number): void;
export declare function emitStrandsInferenceEvent(span: any, requestModel: string, serverAddress: string, serverPort: number, extra?: Record<string, any>): void;
