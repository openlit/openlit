"use strict";
/**
 * Core types, base class, and errors for the OpenLIT guard system.
 *
 * Must stay in sync with: sdk/python/src/openlit/guard/_base.py
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Guard = exports.GuardConfigError = exports.GuardTimeoutError = exports.GuardDeniedError = exports.GuardError = exports.PipelineResult = exports.ACTION_SEVERITY = exports.GuardAction = exports.GuardPhase = void 0;
exports.makeGuardResult = makeGuardResult;
var GuardPhase;
(function (GuardPhase) {
    GuardPhase["PREFLIGHT"] = "preflight";
    GuardPhase["POSTFLIGHT"] = "postflight";
})(GuardPhase || (exports.GuardPhase = GuardPhase = {}));
var GuardAction;
(function (GuardAction) {
    GuardAction["ALLOW"] = "allow";
    GuardAction["DENY"] = "deny";
    GuardAction["REDACT"] = "redact";
    GuardAction["WARN"] = "warn";
})(GuardAction || (exports.GuardAction = GuardAction = {}));
exports.ACTION_SEVERITY = {
    [GuardAction.ALLOW]: 0,
    [GuardAction.WARN]: 1,
    [GuardAction.REDACT]: 2,
    [GuardAction.DENY]: 3,
};
function makeGuardResult(overrides = {}) {
    return {
        action: GuardAction.ALLOW,
        score: 0,
        guardName: '',
        classification: '',
        explanation: '',
        transformedText: null,
        latencyMs: 0,
        ...overrides,
    };
}
class PipelineResult {
    constructor(action = GuardAction.ALLOW, results = [], transformedText = null) {
        this.action = action;
        this.results = results;
        this.transformedText = transformedText;
    }
    get explanation() {
        return this.results
            .map((r) => r.explanation)
            .filter(Boolean)
            .join('; ');
    }
}
exports.PipelineResult = PipelineResult;
// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------
class GuardError extends Error {
    constructor(message) {
        super(message);
        this.name = 'GuardError';
    }
}
exports.GuardError = GuardError;
class GuardDeniedError extends GuardError {
    constructor(result) {
        super(result.explanation);
        this.name = 'GuardDeniedError';
        this.result = result;
    }
}
exports.GuardDeniedError = GuardDeniedError;
/**
 * Reserved for future use -- a per-guard `timeoutMs` option may be
 * added to Pipeline in a later release.
 */
class GuardTimeoutError extends GuardError {
    constructor(message) {
        super(message);
        this.name = 'GuardTimeoutError';
    }
}
exports.GuardTimeoutError = GuardTimeoutError;
class GuardConfigError extends GuardError {
    constructor(message) {
        super(message);
        this.name = 'GuardConfigError';
    }
}
exports.GuardConfigError = GuardConfigError;
class Guard {
    /**
     * @param opts.action - Action to take on violation (`allow`, `deny`, `redact`, `warn`). Default: `deny`.
     * @param opts.maxScanLength - Max characters to scan. Text beyond this limit is not evaluated. Default: 102400.
     */
    constructor(opts = {}) {
        const actionStr = opts.action ?? 'deny';
        const validActions = Object.values(GuardAction);
        if (!validActions.includes(actionStr)) {
            throw new GuardConfigError(`Invalid action '${actionStr}'. Must be one of: ${validActions.join(', ')}`);
        }
        this._action = actionStr;
        const maxScan = opts.maxScanLength ?? 102400;
        if (typeof maxScan !== 'number' || maxScan < 0) {
            throw new GuardConfigError(`Invalid maxScanLength '${maxScan}'. Must be a non-negative number.`);
        }
        this._maxScanLength = maxScan;
    }
    get action() {
        return this._action;
    }
    supportsPhase(phase) {
        return this.phases.includes(phase);
    }
    /** Execute the guard with timing, text-length capping, and phase filtering. */
    run(text, phase) {
        if (!this.supportsPhase(phase)) {
            return makeGuardResult({ guardName: this.name });
        }
        const capped = this._maxScanLength ? text.slice(0, this._maxScanLength) : text;
        const start = performance.now();
        const result = this.evaluate(capped);
        const elapsedMs = performance.now() - start;
        return makeGuardResult({
            action: result.action,
            score: result.score,
            guardName: this.name,
            classification: result.classification,
            explanation: result.explanation,
            transformedText: result.transformedText,
            latencyMs: Math.round(elapsedMs * 1000) / 1000,
        });
    }
}
exports.Guard = Guard;
//# sourceMappingURL=base.js.map