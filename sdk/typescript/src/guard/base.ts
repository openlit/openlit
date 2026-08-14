/**
 * Core types, base class, and errors for the OpenLIT guard system.
 *
 * Must stay in sync with: sdk/python/src/openlit/guard/_base.py
 */

export enum GuardPhase {
  PREFLIGHT = 'preflight',
  POSTFLIGHT = 'postflight',
}

export enum GuardAction {
  ALLOW = 'allow',
  DENY = 'deny',
  REDACT = 'redact',
  WARN = 'warn',
}

export const ACTION_SEVERITY: Record<GuardAction, number> = {
  [GuardAction.ALLOW]: 0,
  [GuardAction.WARN]: 1,
  [GuardAction.REDACT]: 2,
  [GuardAction.DENY]: 3,
};

export interface GuardResult {
  readonly action: GuardAction;
  readonly score: number;
  readonly guardName: string;
  readonly classification: string;
  readonly explanation: string;
  readonly transformedText: string | null;
  readonly latencyMs: number;
}

export function makeGuardResult(overrides: Partial<GuardResult> = {}): GuardResult {
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

export class PipelineResult {
  readonly action: GuardAction;
  readonly results: GuardResult[];
  readonly transformedText: string | null;

  constructor(
    action: GuardAction = GuardAction.ALLOW,
    results: GuardResult[] = [],
    transformedText: string | null = null,
  ) {
    this.action = action;
    this.results = results;
    this.transformedText = transformedText;
  }

  get explanation(): string {
    return this.results
      .map((r) => r.explanation)
      .filter(Boolean)
      .join('; ');
  }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class GuardError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = 'GuardError';
  }
}

export class GuardDeniedError extends GuardError {
  readonly result: PipelineResult;

  constructor(result: PipelineResult) {
    super(result.explanation);
    this.name = 'GuardDeniedError';
    this.result = result;
  }
}

/**
 * Reserved for future use -- a per-guard `timeoutMs` option may be
 * added to Pipeline in a later release.
 */
export class GuardTimeoutError extends GuardError {
  constructor(message?: string) {
    super(message);
    this.name = 'GuardTimeoutError';
  }
}

export class GuardConfigError extends GuardError {
  constructor(message?: string) {
    super(message);
    this.name = 'GuardConfigError';
  }
}

// ---------------------------------------------------------------------------
// Abstract base
// ---------------------------------------------------------------------------

export interface GuardOptions {
  action?: string;
  maxScanLength?: number;
}

export abstract class Guard {
  abstract readonly name: string;
  abstract readonly phases: GuardPhase[];

  protected readonly _action: GuardAction;
  protected readonly _maxScanLength: number;

  /**
   * @param opts.action - Action to take on violation (`allow`, `deny`, `redact`, `warn`). Default: `deny`.
   * @param opts.maxScanLength - Max characters to scan. Text beyond this limit is not evaluated. Default: 102400.
   */
  constructor(opts: GuardOptions = {}) {
    const actionStr = opts.action ?? 'deny';
    const validActions = Object.values(GuardAction) as string[];
    if (!validActions.includes(actionStr)) {
      throw new GuardConfigError(
        `Invalid action '${actionStr}'. Must be one of: ${validActions.join(', ')}`,
      );
    }
    this._action = actionStr as GuardAction;

    const maxScan = opts.maxScanLength ?? 102_400;
    if (typeof maxScan !== 'number' || maxScan < 0) {
      throw new GuardConfigError(
        `Invalid maxScanLength '${maxScan}'. Must be a non-negative number.`,
      );
    }
    this._maxScanLength = maxScan;
  }

  get action(): GuardAction {
    return this._action;
  }

  supportsPhase(phase: GuardPhase): boolean {
    return this.phases.includes(phase);
  }

  /** Execute the guard with timing, text-length capping, and phase filtering. */
  run(text: string, phase: GuardPhase): GuardResult {
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

  /**
   * Evaluate the text and return a GuardResult.
   *
   * Implementations should return a result with `action = this._action`
   * when a violation is detected, or an allow result for a clean pass.
   */
  abstract evaluate(text: string): GuardResult;
}
