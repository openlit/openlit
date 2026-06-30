"use strict";
/**
 * Prompt injection & jailbreak detection guard.
 *
 * Fast regex patterns catch known injection signatures. An optional
 * user-provided classifier handles ambiguous cases.
 *
 * Patterns must stay in sync with: sdk/python/src/openlit/guard/prompt_injection.py
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PromptInjection = void 0;
const base_1 = require("./base");
const INJECTION_PATTERNS = [
    // ---- Instruction override ----
    { label: 'instruction-override', regex: /ignore\s+(?:all\s+)?(?:previous|above|prior)\s+(?:instructions|prompts|rules)/i, weight: 0.9 },
    { label: 'instruction-override-2', regex: /disregard\s+(?:all\s+)?(?:previous|above|prior)\s+(?:instructions|context)/i, weight: 0.9 },
    { label: 'new-instructions', regex: /(?:new|updated|revised)\s+instructions\s*:/i, weight: 0.7 },
    { label: 'do-anything-now', regex: /(?:DAN|do\s+anything\s+now)\s+mode/i, weight: 0.95 },
    { label: 'jailbreak-keyword', regex: /jailbreak(?:ed|ing)?/i, weight: 0.8 },
    // ---- System prompt extraction ----
    { label: 'system-prompt-leak', regex: /(?:show|reveal|display|print|output|repeat|tell\s+me)\s+(?:your|the|me\s+your)\s*(?:system|initial|original|hidden)\s+(?:prompt|instructions|message)/i, weight: 0.85 },
    { label: 'system-prompt-leak-2', regex: /what\s+(?:are|were)\s+your\s+(?:system|initial|original)\s+(?:instructions|prompt)/i, weight: 0.8 },
    { label: 'system-prompt-leak-3', regex: /(?:show|reveal|display|print|output|repeat)\s+(?:me\s+)?your\s+(?:system\s+)?prompt/i, weight: 0.8 },
    // ---- Role impersonation ----
    { label: 'role-play', regex: /(?:you\s+are\s+now|act\s+as|pretend\s+(?:to\s+be|you\s+are)|roleplay\s+as)\s+(?:a\s+)?(?:hacker|evil|malicious|unrestricted|unfiltered)/i, weight: 0.85 },
    { label: 'developer-mode', regex: /(?:developer|debug|admin|god|sudo|root)\s+mode/i, weight: 0.7 },
    // ---- Encoding bypass ----
    { label: 'base64-injection', regex: /(?:decode|base64|eval)\s*\(/i, weight: 0.6 },
    { label: 'markdown-injection', regex: /\[.*?\]\((?:javascript|data):/i, weight: 0.8 },
    // ---- Delimiter abuse ----
    { label: 'delimiter-abuse', regex: /={5,}|<\|(?:im_start|system|endoftext)\|>|###\s*(?:system|instruction)/i, weight: 0.7 },
];
class PromptInjection extends base_1.Guard {
    constructor(opts = {}) {
        super({ action: opts.action ?? 'deny', maxScanLength: opts.maxScanLength });
        this.name = 'prompt_injection';
        this.phases = [base_1.GuardPhase.PREFLIGHT];
        this._threshold = opts.threshold ?? 0.5;
        this._classifier = opts.classifier;
    }
    evaluate(text) {
        const matchedLabels = [];
        let maxWeight = 0;
        for (const { label, regex, weight } of INJECTION_PATTERNS) {
            if (regex.test(text)) {
                matchedLabels.push(label);
                if (weight > maxWeight) {
                    maxWeight = weight;
                }
            }
        }
        let score = maxWeight;
        if (matchedLabels.length === 0 && this._classifier) {
            score = this._classifier(text);
        }
        if (score >= this._threshold) {
            const classification = matchedLabels.length > 0 ? matchedLabels.join(', ') : 'classifier';
            return (0, base_1.makeGuardResult)({
                action: this._action,
                score: Math.round(score * 1000) / 1000,
                guardName: this.name,
                classification,
                explanation: `Prompt injection detected (score=${score.toFixed(2)}): ${classification}`,
            });
        }
        return (0, base_1.makeGuardResult)({ guardName: this.name, score: Math.round(score * 1000) / 1000 });
    }
}
exports.PromptInjection = PromptInjection;
//# sourceMappingURL=prompt-injection.js.map