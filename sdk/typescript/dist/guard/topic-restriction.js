"use strict";
/**
 * Topic restriction guard.
 *
 * Enforces allow/deny topic lists using a user-provided topic classifier.
 *
 * Must stay in sync with: sdk/python/src/openlit/guard/topic_restriction.py
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TopicRestriction = void 0;
const base_1 = require("./base");
class TopicRestriction extends base_1.Guard {
    constructor(opts) {
        super({ action: opts.action ?? 'deny', maxScanLength: opts.maxScanLength });
        this.name = 'topic_restriction';
        this.phases = [base_1.GuardPhase.PREFLIGHT];
        if (typeof opts.classifier !== 'function') {
            throw new base_1.GuardConfigError("TopicRestriction requires a callable 'classifier'");
        }
        if (opts.allowed && opts.denied) {
            throw new base_1.GuardConfigError("Provide either 'allowed' or 'denied', not both");
        }
        if (!opts.allowed && !opts.denied) {
            throw new base_1.GuardConfigError("Provide either 'allowed' or 'denied' topic list");
        }
        this._classifier = opts.classifier;
        this._allowed = opts.allowed ? new Set(opts.allowed.map((t) => t.toLowerCase())) : null;
        this._denied = opts.denied ? new Set(opts.denied.map((t) => t.toLowerCase())) : null;
    }
    evaluate(text) {
        const topic = this._classifier(text).toLowerCase().trim();
        if (this._allowed !== null && !this._allowed.has(topic)) {
            return (0, base_1.makeGuardResult)({
                action: this._action,
                score: 1.0,
                guardName: this.name,
                classification: topic,
                explanation: `Topic '${topic}' is not in the allowed list`,
            });
        }
        if (this._denied !== null && this._denied.has(topic)) {
            return (0, base_1.makeGuardResult)({
                action: this._action,
                score: 1.0,
                guardName: this.name,
                classification: topic,
                explanation: `Topic '${topic}' is in the denied list`,
            });
        }
        return (0, base_1.makeGuardResult)({ guardName: this.name, classification: topic });
    }
}
exports.TopicRestriction = TopicRestriction;
//# sourceMappingURL=topic-restriction.js.map