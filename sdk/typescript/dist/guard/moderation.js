"use strict";
/**
 * Content moderation guard -- profanity & toxicity detection.
 *
 * Uses local keyword/regex patterns.
 *
 * Patterns must stay in sync with: sdk/python/src/openlit/guard/moderation.py
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Moderation = void 0;
const base_1 = require("./base");
const BUILTIN_WORDS = [
    'fuck', 'shit', 'ass', 'bitch', 'damn', 'bastard', 'crap',
    'dick', 'piss', 'cock', 'cunt', 'slut', 'whore',
    'nigger', 'nigga', 'faggot', 'retard', 'kike', 'spic',
];
const TOXICITY_PATTERNS = [
    /\b(?:kill\s+yourself|kys|go\s+die|hope\s+you\s+die)\b/i,
    /\b(?:i(?:'ll| will)\s+(?:kill|hurt|destroy)\s+you)\b/i,
];
function buildProfanityPattern(words) {
    const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return new RegExp('\\b(?:' + escaped.join('|') + ')\\b', 'gi');
}
class Moderation extends base_1.Guard {
    constructor(opts = {}) {
        super({ action: opts.action ?? 'warn', maxScanLength: opts.maxScanLength });
        this.name = 'moderation';
        this.phases = [base_1.GuardPhase.PREFLIGHT, base_1.GuardPhase.POSTFLIGHT];
        const allWords = [...BUILTIN_WORDS, ...(opts.customWords || [])];
        this._profanityRe = buildProfanityPattern(allWords);
    }
    evaluate(text) {
        const profanityMatches = text.match(this._profanityRe);
        const toxicityHits = TOXICITY_PATTERNS.some((pat) => pat.test(text));
        if (!profanityMatches && !toxicityHits) {
            return (0, base_1.makeGuardResult)({ guardName: this.name });
        }
        const classifications = [];
        if (profanityMatches)
            classifications.push('profanity');
        if (toxicityHits)
            classifications.push('toxicity');
        const classification = classifications.join(', ');
        const score = toxicityHits ? 0.95 : 0.7;
        let transformedText = null;
        if (this._action === 'redact') {
            transformedText = text.replace(this._profanityRe, '[REDACTED:profanity]');
        }
        return (0, base_1.makeGuardResult)({
            action: this._action,
            score,
            guardName: this.name,
            classification,
            explanation: `Moderation flag: ${classification}`,
            transformedText,
        });
    }
}
exports.Moderation = Moderation;
//# sourceMappingURL=moderation.js.map