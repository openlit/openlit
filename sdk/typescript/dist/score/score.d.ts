import { Span } from '@opentelemetry/api';
type OtelSafeMetadataValue = string | number | boolean;
type OtelSafeMetadataArray = OtelSafeMetadataValue[];
export interface LogScoreOptions {
    name: string;
    value: number | boolean | string;
    span?: Span;
    traceId?: string;
    spanId?: string;
    comment?: string;
    idempotencyKey?: string;
    metadata?: Record<string, OtelSafeMetadataValue | OtelSafeMetadataArray>;
}
export declare function logScore(options: LogScoreOptions): boolean;
export {};
