/**
 * OpenLIT OpenAI Agents Instrumentation
 *
 * Registers an OpenLITTracingProcessor with the @openai/agents SDK's
 * tracing system, and wraps Agent construction to emit create_agent spans.
 * Mirrors the Python SDK instrumentation in
 * sdk/python/src/openlit/instrumentation/openai_agents/.
 */
import { InstrumentationBase, InstrumentationModuleDefinition } from '@opentelemetry/instrumentation';
import type { InstrumentationConfig } from '@opentelemetry/instrumentation';
export default class OpenAIAgentsInstrumentation extends InstrumentationBase {
    private _processor;
    private _registry;
    constructor(config?: InstrumentationConfig);
    protected init(): InstrumentationModuleDefinition | InstrumentationModuleDefinition[] | void;
    manualPatch(moduleExports: any): void;
    private _patch;
    private _wrapAgentConstructor;
    private _unpatch;
}
