/**
 * OpenLIT Guard System -- public API.
 *
 * Re-exports all guard classes, pipeline, types, and errors.
 */
export { Guard, GuardAction, GuardPhase, GuardConfigError, GuardDeniedError, GuardError, GuardTimeoutError, PipelineResult, ACTION_SEVERITY, makeGuardResult, } from './base';
export type { GuardResult, GuardOptions } from './base';
export { Pipeline } from './pipeline';
export type { PipelineOptions } from './pipeline';
export { PII } from './pii';
export type { PIIOptions } from './pii';
export { PromptInjection } from './prompt-injection';
export type { PromptInjectionOptions } from './prompt-injection';
export { Moderation } from './moderation';
export type { ModerationOptions } from './moderation';
export { SensitiveTopic } from './sensitive-topic';
export type { SensitiveTopicOptions } from './sensitive-topic';
export { TopicRestriction } from './topic-restriction';
export type { TopicRestrictionOptions } from './topic-restriction';
export { Schema } from './schema';
export type { SchemaOptions } from './schema';
export { Custom } from './custom';
export type { CustomOptions } from './custom';
export { setupAutoGuards } from './integration';
