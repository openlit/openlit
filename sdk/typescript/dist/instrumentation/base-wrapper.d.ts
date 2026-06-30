import { Span } from '@opentelemetry/api';
export type BaseSpanAttributes = {
    genAIEndpoint: string;
    model: string;
    user?: unknown;
    cost?: number | string;
    aiSystem: string;
    serverAddress?: string;
    serverPort?: number;
    errorType?: string;
};
export default class BaseWrapper {
    static setBaseSpanAttributes(span: Span, { genAIEndpoint: _genAIEndpoint, model, user, cost, aiSystem, serverAddress, serverPort }: BaseSpanAttributes): void;
    static recordMetrics(span: Span, baseAttributes: BaseSpanAttributes): void;
    static getSpanAttribute(span: Span, key: string): number | undefined;
}
