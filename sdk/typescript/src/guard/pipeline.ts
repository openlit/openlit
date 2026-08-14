/**
 * Guard Pipeline -- composes multiple guards into an ordered evaluation chain.
 *
 * Must stay in sync with: sdk/python/src/openlit/guard/_pipeline.py
 */

import { trace } from '@opentelemetry/api';
import {
  Guard,
  GuardAction,
  GuardPhase,
  GuardResult,
  PipelineResult,
  ACTION_SEVERITY,
  GuardConfigError,
  makeGuardResult,
} from './base';

export interface PipelineOptions {
  guards?: Guard[];
  failOpen?: boolean;
}

export class Pipeline {
  private readonly _guards: Guard[];
  private readonly _failOpen: boolean;

  constructor(opts: PipelineOptions = {}) {
    this._guards = [...(opts.guards || [])];
    this._failOpen = opts.failOpen ?? true;
  }

  get guards(): Guard[] {
    return [...this._guards];
  }

  evaluate(text: string, phase: string = 'preflight'): PipelineResult {
    const validPhases = Object.values(GuardPhase) as string[];
    if (!validPhases.includes(phase)) {
      throw new GuardConfigError(
        `Invalid phase '${phase}'. Must be one of: ${validPhases.join(', ')}`,
      );
    }
    const guardPhase = phase as GuardPhase;
    const results: GuardResult[] = [];
    let currentText = text;
    let worstAction = GuardAction.ALLOW;

    for (const guard of this._guards) {
      if (!guard.supportsPhase(guardPhase)) {
        continue;
      }

      let result: GuardResult;
      try {
        result = guard.run(currentText, guardPhase);
      } catch (e) {
        if (this._failOpen) {
          console.warn(
            `Guard '${guard.name}' raised during ${phase} evaluation; fail-open -> allow`,
            e,
          );
          result = makeGuardResult({ guardName: guard.name });
        } else {
          throw e;
        }
      }

      results.push(result);
      Pipeline._emitOtel(result, phase);

      if (ACTION_SEVERITY[result.action] > ACTION_SEVERITY[worstAction]) {
        worstAction = result.action;
      }

      if (result.action === GuardAction.REDACT && result.transformedText !== null) {
        currentText = result.transformedText;
      }

      if (result.action === GuardAction.DENY) {
        break;
      }
    }

    const transformed = currentText !== text ? currentText : null;
    return new PipelineResult(worstAction, results, transformed);
  }

  private static _emitOtel(result: GuardResult, phase: string): void {
    try {
      const Metrics = require('../otel/metrics').default;
      if (Metrics?.guardRequests) {
        Metrics.guardRequests.add(1, {
          'guard.name': result.guardName,
          'guard.action': result.action,
          'guard.score': result.score,
          'guard.classification': result.classification,
          'guard.phase': phase,
        });
      }
    } catch {
      // metrics not initialized yet
    }

    try {
      const span = trace.getActiveSpan();
      if (span && span.isRecording()) {
        span.addEvent('guard.evaluation', {
          'guard.name': result.guardName,
          'guard.phase': phase,
          'guard.action': result.action,
          'guard.score': result.score,
          'guard.classification': result.classification,
          'guard.explanation': result.explanation,
          'guard.latency_ms': result.latencyMs,
        });
      }
    } catch {
      // no active span
    }
  }
}
