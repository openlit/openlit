/**
 * Custom guard -- user-defined regex or callable.
 *
 * Must stay in sync with: sdk/python/src/openlit/guard/custom.py
 */

import {
  Guard,
  GuardConfigError,
  GuardPhase,
  GuardResult,
  makeGuardResult,
  GuardOptions,
} from './base';

export interface CustomOptions extends GuardOptions {
  pattern?: string;
  callable?: (text: string) => GuardResult;
  phases?: string[];
}

export class Custom extends Guard {
  readonly name = 'custom';
  readonly phases: GuardPhase[];

  private readonly _pattern: RegExp | null;
  private readonly _callable?: (text: string) => GuardResult;

  constructor(opts: CustomOptions = {}) {
    super({ action: opts.action ?? 'deny', maxScanLength: opts.maxScanLength });

    if (!opts.pattern && !opts.callable) {
      throw new GuardConfigError("Custom guard needs at least 'pattern' or 'callable'");
    }

    this._pattern = opts.pattern ? new RegExp(opts.pattern) : null;
    this._callable = opts.callable;

    if (opts.phases) {
      this.phases = opts.phases.map((p) => p as GuardPhase);
    } else {
      this.phases = [GuardPhase.PREFLIGHT, GuardPhase.POSTFLIGHT];
    }
  }

  evaluate(text: string): GuardResult {
    if (this._pattern) {
      const match = this._pattern.exec(text);
      if (match) {
        return makeGuardResult({
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

    return makeGuardResult({ guardName: this.name });
  }
}
