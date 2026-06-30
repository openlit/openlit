/**
 * PII guard -- detects and optionally redacts personally identifiable
 * information, API keys, and secrets using regex patterns.
 *
 * Patterns must stay in sync with: sdk/python/src/openlit/guard/pii.py
 */
import { Guard, GuardPhase, GuardResult, GuardOptions } from './base';
export interface PIIOptions extends GuardOptions {
    customPatterns?: Record<string, string>;
}
export declare class PII extends Guard {
    readonly name = "pii";
    readonly phases: GuardPhase[];
    private readonly _allPatterns;
    constructor(opts?: PIIOptions);
    evaluate(text: string): GuardResult;
}
