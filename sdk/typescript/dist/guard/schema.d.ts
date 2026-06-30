/**
 * Schema validation guard for structured LLM outputs.
 *
 * Validates that model output is valid JSON and/or conforms to a JSON schema.
 *
 * Must stay in sync with: sdk/python/src/openlit/guard/schema.py
 */
import { Guard, GuardPhase, GuardResult, GuardOptions } from './base';
export interface SchemaOptions extends GuardOptions {
    jsonMode?: boolean;
    schema?: Record<string, unknown>;
}
export declare class Schema extends Guard {
    readonly name = "schema";
    readonly phases: GuardPhase[];
    private readonly _jsonMode;
    private readonly _schema;
    constructor(opts?: SchemaOptions);
    evaluate(text: string): GuardResult;
}
