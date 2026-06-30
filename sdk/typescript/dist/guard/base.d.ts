/**
 * Core types, base class, and errors for the OpenLIT guard system.
 *
 * Must stay in sync with: sdk/python/src/openlit/guard/_base.py
 */
export declare enum GuardPhase {
    PREFLIGHT = "preflight",
    POSTFLIGHT = "postflight"
}
export declare enum GuardAction {
    ALLOW = "allow",
    DENY = "deny",
    REDACT = "redact",
    WARN = "warn"
}
export declare const ACTION_SEVERITY: Record<GuardAction, number>;
export interface GuardResult {
    readonly action: GuardAction;
    readonly score: number;
    readonly guardName: string;
    readonly classification: string;
    readonly explanation: string;
    readonly transformedText: string | null;
    readonly latencyMs: number;
}
export declare function makeGuardResult(overrides?: Partial<GuardResult>): GuardResult;
export declare class PipelineResult {
    readonly action: GuardAction;
    readonly results: GuardResult[];
    readonly transformedText: string | null;
    constructor(action?: GuardAction, results?: GuardResult[], transformedText?: string | null);
    get explanation(): string;
}
export declare class GuardError extends Error {
    constructor(message?: string);
}
export declare class GuardDeniedError extends GuardError {
    readonly result: PipelineResult;
    constructor(result: PipelineResult);
}
/**
 * Reserved for future use -- a per-guard `timeoutMs` option may be
 * added to Pipeline in a later release.
 */
export declare class GuardTimeoutError extends GuardError {
    constructor(message?: string);
}
export declare class GuardConfigError extends GuardError {
    constructor(message?: string);
}
export interface GuardOptions {
    action?: string;
    maxScanLength?: number;
}
export declare abstract class Guard {
    abstract readonly name: string;
    abstract readonly phases: GuardPhase[];
    protected readonly _action: GuardAction;
    protected readonly _maxScanLength: number;
    /**
     * @param opts.action - Action to take on violation (`allow`, `deny`, `redact`, `warn`). Default: `deny`.
     * @param opts.maxScanLength - Max characters to scan. Text beyond this limit is not evaluated. Default: 102400.
     */
    constructor(opts?: GuardOptions);
    get action(): GuardAction;
    supportsPhase(phase: GuardPhase): boolean;
    /** Execute the guard with timing, text-length capping, and phase filtering. */
    run(text: string, phase: GuardPhase): GuardResult;
    /**
     * Evaluate the text and return a GuardResult.
     *
     * Implementations should return a result with `action = this._action`
     * when a violation is detected, or an allow result for a clean pass.
     */
    abstract evaluate(text: string): GuardResult;
}
