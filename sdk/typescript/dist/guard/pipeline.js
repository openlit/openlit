"use strict";
/**
 * Guard Pipeline -- composes multiple guards into an ordered evaluation chain.
 *
 * Must stay in sync with: sdk/python/src/openlit/guard/_pipeline.py
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Pipeline = void 0;
const api_1 = require("@opentelemetry/api");
const base_1 = require("./base");
class Pipeline {
    constructor(opts = {}) {
        this._guards = [...(opts.guards || [])];
        this._failOpen = opts.failOpen ?? true;
    }
    get guards() {
        return [...this._guards];
    }
    evaluate(text, phase = 'preflight') {
        const validPhases = Object.values(base_1.GuardPhase);
        if (!validPhases.includes(phase)) {
            throw new base_1.GuardConfigError(`Invalid phase '${phase}'. Must be one of: ${validPhases.join(', ')}`);
        }
        const guardPhase = phase;
        const results = [];
        let currentText = text;
        let worstAction = base_1.GuardAction.ALLOW;
        for (const guard of this._guards) {
            if (!guard.supportsPhase(guardPhase)) {
                continue;
            }
            let result;
            try {
                result = guard.run(currentText, guardPhase);
            }
            catch (e) {
                if (this._failOpen) {
                    console.warn(`Guard '${guard.name}' raised during ${phase} evaluation; fail-open -> allow`, e);
                    result = (0, base_1.makeGuardResult)({ guardName: guard.name });
                }
                else {
                    throw e;
                }
            }
            results.push(result);
            Pipeline._emitOtel(result, phase);
            if (base_1.ACTION_SEVERITY[result.action] > base_1.ACTION_SEVERITY[worstAction]) {
                worstAction = result.action;
            }
            if (result.action === base_1.GuardAction.REDACT && result.transformedText !== null) {
                currentText = result.transformedText;
            }
            if (result.action === base_1.GuardAction.DENY) {
                break;
            }
        }
        const transformed = currentText !== text ? currentText : null;
        return new base_1.PipelineResult(worstAction, results, transformed);
    }
    static _emitOtel(result, phase) {
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
        }
        catch {
            // metrics not initialized yet
        }
        try {
            const span = api_1.trace.getActiveSpan();
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
        }
        catch {
            // no active span
        }
    }
}
exports.Pipeline = Pipeline;
//# sourceMappingURL=pipeline.js.map