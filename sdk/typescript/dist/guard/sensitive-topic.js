"use strict";
/**
 * Sensitive topic detection guard.
 *
 * Uses keyword/regex dictionaries for fast-path detection of sensitive
 * content categories. An optional user-provided classifier handles
 * ambiguous cases.
 *
 * Patterns must stay in sync with: sdk/python/src/openlit/guard/sensitive_topic.py
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SensitiveTopic = void 0;
const base_1 = require("./base");
const DEFAULT_CATEGORIES = {
    violence: [
        /\b(?:kill|murder|assault|attack|weapon|bomb|shoot|stab|torture|terrorism|massacre|genocide)\b/i,
    ],
    politics: [
        /\b(?:democrat|republican|election\s+fraud|political\s+party|vote\s+rigging|coup|insurrection)\b/i,
    ],
    substance_use: [
        /\b(?:cocaine|heroin|methamphetamine|fentanyl|drug\s+(?:deal|traffick)|overdose|illegal\s+drugs)\b/i,
    ],
    mental_health: [
        /\b(?:suicid(?:e|al)|self[- ]harm|eating\s+disorder|anorexia|bulimia)\b/i,
    ],
    discrimination: [
        /\b(?:racial\s+slur|white\s+supremac|ethnic\s+cleansing|hate\s+(?:speech|crime))\b/i,
    ],
    adult_content: [
        /\b(?:pornograph|explicit\s+sexual|nude\s+images|sex\s+trafficking)\b/i,
    ],
};
class SensitiveTopic extends base_1.Guard {
    constructor(opts = {}) {
        super({ action: opts.action ?? 'warn', maxScanLength: opts.maxScanLength });
        this.name = 'sensitive_topic';
        this.phases = [base_1.GuardPhase.PREFLIGHT, base_1.GuardPhase.POSTFLIGHT];
        this._classifier = opts.classifier;
        const allowedCategories = opts.categories
            ? new Set(opts.categories)
            : null;
        this._patterns = {};
        for (const [cat, pats] of Object.entries(DEFAULT_CATEGORIES)) {
            if (allowedCategories === null || allowedCategories.has(cat)) {
                this._patterns[cat] = [...pats];
            }
        }
        if (opts.customCategories) {
            for (const [cat, rawPats] of Object.entries(opts.customCategories)) {
                const compiled = rawPats.map((p) => new RegExp(p, 'i'));
                if (!this._patterns[cat]) {
                    this._patterns[cat] = [];
                }
                this._patterns[cat].push(...compiled);
            }
        }
    }
    evaluate(text) {
        const detected = [];
        for (const [cat, patterns] of Object.entries(this._patterns)) {
            for (const pat of patterns) {
                if (pat.test(text)) {
                    detected.push(cat);
                    break;
                }
            }
        }
        if (detected.length === 0 && this._classifier) {
            const result = this._classifier(text);
            if (result) {
                detected.push(result);
            }
        }
        if (detected.length > 0) {
            const classification = [...detected].sort().join(', ');
            return (0, base_1.makeGuardResult)({
                action: this._action,
                score: Math.round(Math.min(1.0, detected.length * 0.3 + 0.4) * 100) / 100,
                guardName: this.name,
                classification,
                explanation: `Sensitive topic(s) detected: ${classification}`,
            });
        }
        return (0, base_1.makeGuardResult)({ guardName: this.name });
    }
}
exports.SensitiveTopic = SensitiveTopic;
//# sourceMappingURL=sensitive-topic.js.map