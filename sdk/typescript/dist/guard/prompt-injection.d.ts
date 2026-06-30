/**
 * Prompt injection & jailbreak detection guard.
 *
 * Fast regex patterns catch known injection signatures. An optional
 * user-provided classifier handles ambiguous cases.
 *
 * Patterns must stay in sync with: sdk/python/src/openlit/guard/prompt_injection.py
 */
import { Guard, GuardPhase, GuardResult, GuardOptions } from './base';
export interface PromptInjectionOptions extends GuardOptions {
    threshold?: number;
    classifier?: (text: string) => number;
}
export declare class PromptInjection extends Guard {
    readonly name = "prompt_injection";
    readonly phases: GuardPhase[];
    private readonly _threshold;
    private readonly _classifier?;
    constructor(opts?: PromptInjectionOptions);
    evaluate(text: string): GuardResult;
}
