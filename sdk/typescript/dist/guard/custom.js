"use strict";
/**
 * Custom guard -- user-defined regex or callable.
 *
 * Must stay in sync with: sdk/python/src/openlit/guard/custom.py
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Custom = void 0;
const base_1 = require("./base");
class Custom extends base_1.Guard {
    constructor(opts = {}) {
        super({ action: opts.action ?? 'deny', maxScanLength: opts.maxScanLength });
        this.name = 'custom';
        if (!opts.pattern && !opts.callable) {
            throw new base_1.GuardConfigError("Custom guard needs at least 'pattern' or 'callable'");
        }
        this._pattern = opts.pattern ? new RegExp(opts.pattern) : null;
        this._callable = opts.callable;
        if (opts.phases) {
            this.phases = opts.phases.map((p) => p);
        }
        else {
            this.phases = [base_1.GuardPhase.PREFLIGHT, base_1.GuardPhase.POSTFLIGHT];
        }
    }
    evaluate(text) {
        if (this._pattern) {
            const match = this._pattern.exec(text);
            if (match) {
                return (0, base_1.makeGuardResult)({
                    action: this._action,
                    score: 1.0,
                    guardName: this.name,
                    classification: 'pattern_match',
                    explanation: `Custom pattern matched: '${match[0]}'`,
                });
            }
        }
        if (this._callable) {
            return this._callable(text);
        }
        return (0, base_1.makeGuardResult)({ guardName: this.name });
    }
}
exports.Custom = Custom;
//# sourceMappingURL=custom.js.map