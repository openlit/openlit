/**
 * Custom guard -- user-defined regex or callable.
 *
 * Must stay in sync with: sdk/python/src/openlit/guard/custom.py
 */
import { Guard, GuardPhase, GuardResult, GuardOptions } from './base';
export interface CustomOptions extends GuardOptions {
    pattern?: string;
    callable?: (text: string) => GuardResult;
    phases?: string[];
}
export declare class Custom extends Guard {
    readonly name = "custom";
    readonly phases: GuardPhase[];
    private readonly _pattern;
    private readonly _callable?;
    constructor(opts?: CustomOptions);
    evaluate(text: string): GuardResult;
}
