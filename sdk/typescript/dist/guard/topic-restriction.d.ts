/**
 * Topic restriction guard.
 *
 * Enforces allow/deny topic lists using a user-provided topic classifier.
 *
 * Must stay in sync with: sdk/python/src/openlit/guard/topic_restriction.py
 */
import { Guard, GuardPhase, GuardResult, GuardOptions } from './base';
export interface TopicRestrictionOptions extends GuardOptions {
    classifier: (text: string) => string;
    allowed?: string[];
    denied?: string[];
}
export declare class TopicRestriction extends Guard {
    readonly name = "topic_restriction";
    readonly phases: GuardPhase[];
    private readonly _classifier;
    private readonly _allowed;
    private readonly _denied;
    constructor(opts: TopicRestrictionOptions);
    evaluate(text: string): GuardResult;
}
