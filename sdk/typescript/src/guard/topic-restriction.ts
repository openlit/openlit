/**
 * Topic restriction guard.
 *
 * Enforces allow/deny topic lists using a user-provided topic classifier.
 *
 * Must stay in sync with: sdk/python/src/openlit/guard/topic_restriction.py
 */

import { Guard, GuardConfigError, GuardPhase, GuardResult, makeGuardResult, GuardOptions } from './base';

export interface TopicRestrictionOptions extends GuardOptions {
  classifier: (text: string) => string;
  allowed?: string[];
  denied?: string[];
}

export class TopicRestriction extends Guard {
  readonly name = 'topic_restriction';
  readonly phases = [GuardPhase.PREFLIGHT];

  private readonly _classifier: (text: string) => string;
  private readonly _allowed: Set<string> | null;
  private readonly _denied: Set<string> | null;

  constructor(opts: TopicRestrictionOptions) {
    super({ action: opts.action ?? 'deny', maxScanLength: opts.maxScanLength });

    if (typeof opts.classifier !== 'function') {
      throw new GuardConfigError("TopicRestriction requires a callable 'classifier'");
    }
    if (opts.allowed && opts.denied) {
      throw new GuardConfigError("Provide either 'allowed' or 'denied', not both");
    }
    if (!opts.allowed && !opts.denied) {
      throw new GuardConfigError("Provide either 'allowed' or 'denied' topic list");
    }

    this._classifier = opts.classifier;
    this._allowed = opts.allowed ? new Set(opts.allowed.map((t) => t.toLowerCase())) : null;
    this._denied = opts.denied ? new Set(opts.denied.map((t) => t.toLowerCase())) : null;
  }

  evaluate(text: string): GuardResult {
    const topic = this._classifier(text).toLowerCase().trim();

    if (this._allowed !== null && !this._allowed.has(topic)) {
      return makeGuardResult({
        action: this._action,
        score: 1.0,
        guardName: this.name,
        classification: topic,
        explanation: `Topic '${topic}' is not in the allowed list`,
      });
    }

    if (this._denied !== null && this._denied.has(topic)) {
      return makeGuardResult({
        action: this._action,
        score: 1.0,
        guardName: this.name,
        classification: topic,
        explanation: `Topic '${topic}' is in the denied list`,
      });
    }

    return makeGuardResult({ guardName: this.name, classification: topic });
  }
}
