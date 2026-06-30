/**
 * Sensitive topic detection guard.
 *
 * Uses keyword/regex dictionaries for fast-path detection of sensitive
 * content categories. An optional user-provided classifier handles
 * ambiguous cases.
 *
 * Patterns must stay in sync with: sdk/python/src/openlit/guard/sensitive_topic.py
 */
import { Guard, GuardPhase, GuardResult, GuardOptions } from './base';
export interface SensitiveTopicOptions extends GuardOptions {
    categories?: Set<string> | string[];
    customCategories?: Record<string, string[]>;
    classifier?: (text: string) => string | null;
}
export declare class SensitiveTopic extends Guard {
    readonly name = "sensitive_topic";
    readonly phases: GuardPhase[];
    private readonly _patterns;
    private readonly _classifier?;
    constructor(opts?: SensitiveTopicOptions);
    evaluate(text: string): GuardResult;
}
