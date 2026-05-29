/**
 * Content moderation guard -- profanity & toxicity detection.
 *
 * Uses local keyword/regex patterns.
 *
 * Patterns must stay in sync with: sdk/python/src/openlit/guard/moderation.py
 */

import { Guard, GuardPhase, GuardResult, makeGuardResult, GuardOptions } from './base';

const BUILTIN_WORDS: string[] = [
  'fuck', 'shit', 'ass', 'bitch', 'damn', 'bastard', 'crap',
  'dick', 'piss', 'cock', 'cunt', 'slut', 'whore',
  'nigger', 'nigga', 'faggot', 'retard', 'kike', 'spic',
];

const TOXICITY_PATTERNS: RegExp[] = [
  /\b(?:kill\s+yourself|kys|go\s+die|hope\s+you\s+die)\b/i,
  /\b(?:i(?:'ll| will)\s+(?:kill|hurt|destroy)\s+you)\b/i,
];

function buildProfanityPattern(words: string[]): RegExp {
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp('\\b(?:' + escaped.join('|') + ')\\b', 'gi');
}

export interface ModerationOptions extends GuardOptions {
  customWords?: string[];
}

export class Moderation extends Guard {
  readonly name = 'moderation';
  readonly phases = [GuardPhase.PREFLIGHT, GuardPhase.POSTFLIGHT];

  private readonly _profanityRe: RegExp;

  constructor(opts: ModerationOptions = {}) {
    super({ action: opts.action ?? 'warn', maxScanLength: opts.maxScanLength });
    const allWords = [...BUILTIN_WORDS, ...(opts.customWords || [])];
    this._profanityRe = buildProfanityPattern(allWords);
  }

  evaluate(text: string): GuardResult {
    const profanityMatches = text.match(this._profanityRe);
    const toxicityHits = TOXICITY_PATTERNS.some((pat) => pat.test(text));

    if (!profanityMatches && !toxicityHits) {
      return makeGuardResult({ guardName: this.name });
    }

    const classifications: string[] = [];
    if (profanityMatches) classifications.push('profanity');
    if (toxicityHits) classifications.push('toxicity');

    const classification = classifications.join(', ');
    const score = toxicityHits ? 0.95 : 0.7;

    let transformedText: string | null = null;
    if (this._action === 'redact') {
      transformedText = text.replace(this._profanityRe, '[REDACTED:profanity]');
    }

    return makeGuardResult({
      action: this._action,
      score,
      guardName: this.name,
      classification,
      explanation: `Moderation flag: ${classification}`,
      transformedText,
    });
  }
}
