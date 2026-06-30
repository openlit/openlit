import { resourceFromAttributes } from '@opentelemetry/resources';
import { OpenlitOptions, ResolvedOptions } from './types';
import BaseOpenlit from './features/base';
import { usingAttributes, injectAdditionalAttributes, setAgentVersion, resetAgentVersion, runWithAgentVersion, getCurrentAgentVersion } from './helpers';
import { runEval, runEvalBatch, fetchEvalTypes } from './evals';
import { logScore } from './score';
import { TracedSpan, startTrace, trace as traceManual } from './manual-trace';
import { PII } from './guard/pii';
import { PromptInjection } from './guard/prompt-injection';
import { Moderation } from './guard/moderation';
import { SensitiveTopic } from './guard/sensitive-topic';
import { TopicRestriction } from './guard/topic-restriction';
import { Schema } from './guard/schema';
import { Custom } from './guard/custom';
import { Pipeline } from './guard/pipeline';
import { Guard, GuardAction, GuardPhase, GuardError, GuardDeniedError, GuardTimeoutError, GuardConfigError, PipelineResult } from './guard/base';
declare class Openlit extends BaseOpenlit {
    static resource: ReturnType<typeof resourceFromAttributes>;
    static options: ResolvedOptions;
    static PII: typeof PII;
    static PromptInjection: typeof PromptInjection;
    static Moderation: typeof Moderation;
    static SensitiveTopic: typeof SensitiveTopic;
    static TopicRestriction: typeof TopicRestriction;
    static Schema: typeof Schema;
    static Custom: typeof Custom;
    static Pipeline: typeof Pipeline;
    static GuardAction: typeof GuardAction;
    static GuardPhase: typeof GuardPhase;
    static GuardError: typeof GuardError;
    static GuardDeniedError: typeof GuardDeniedError;
    static GuardTimeoutError: typeof GuardTimeoutError;
    static GuardConfigError: typeof GuardConfigError;
    static eval: typeof runEval;
    static evalBatch: typeof runEvalBatch;
    static getEvalTypes: typeof fetchEvalTypes;
    static logScore: typeof logScore;
    /**
     * Public API: stamp every subsequent chat span / inference event in the
     * current async scope with a user-supplied agent version label
     * (`gen_ai.agent.version`). Useful when you want versions to follow a
     * release tag, git SHA, or business-meaningful name instead of the SDK's
     * auto-computed fingerprint.
     *
     * For a one-shot block, prefer `OpenLit.withAgentVersion(label, fn)`.
     */
    static setAgentVersion: typeof setAgentVersion;
    /**
     * Clear the agent version label set by `setAgentVersion`. Always call this
     * in a `finally` block when you use `setAgentVersion` directly, otherwise
     * the label will persist on subsequent requests handled by the same
     * worker. Prefer `withAgentVersion(label, fn)` for scoped usage.
     */
    static resetAgentVersion: typeof resetAgentVersion;
    static withAgentVersion: typeof runWithAgentVersion;
    static getAgentVersion: typeof getCurrentAgentVersion;
    static startTrace: typeof startTrace;
    static trace: typeof traceManual;
    static init(options?: OpenlitOptions): void;
}
declare const openlit: typeof Openlit & {
    usingAttributes: typeof usingAttributes;
    injectAdditionalAttributes: typeof injectAdditionalAttributes;
};
export default openlit;
export { Openlit, usingAttributes, injectAdditionalAttributes, logScore };
export { TracedSpan, startTrace, traceManual as trace };
export type { OpenlitOptions } from './types';
export type { LogScoreOptions } from './score';
export { PII, PromptInjection, Moderation, SensitiveTopic, TopicRestriction, Schema, Custom, Pipeline, Guard, GuardAction, GuardPhase, GuardError, GuardDeniedError, GuardTimeoutError, GuardConfigError, PipelineResult, };
export type { GuardResult } from './guard/base';
