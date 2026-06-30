/**
 * Content moderation guard -- profanity & toxicity detection.
 *
 * Uses local keyword/regex patterns.
 *
 * Patterns must stay in sync with: sdk/python/src/openlit/guard/moderation.py
 */
import { Guard, GuardPhase, GuardResult, GuardOptions } from './base';
export interface ModerationOptions extends GuardOptions {
    customWords?: string[];
}
export declare class Moderation extends Guard {
    readonly name = "moderation";
    readonly phases: GuardPhase[];
    private readonly _profanityRe;
    constructor(opts?: ModerationOptions);
    evaluate(text: string): GuardResult;
}
