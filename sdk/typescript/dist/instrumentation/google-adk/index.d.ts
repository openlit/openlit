import { InstrumentationBase, InstrumentationModuleDefinition } from '@opentelemetry/instrumentation';
import { InstrumentationConfig } from '@opentelemetry/instrumentation';
export interface GoogleADKInstrumentationConfig extends InstrumentationConfig {
}
/**
 * OTel GenAI semantic convention compliant instrumentor for Google ADK.
 *
 * Monkey-patches Runner, BaseAgent, and LlmAgent from @google/adk.
 * Replaces ADK's internal tracers with PassthroughTracer to suppress
 * duplicate spans. Enriches ADK's LLM and tool spans with OTel attributes.
 */
export default class GoogleADKInstrumentation extends InstrumentationBase {
    private _registry;
    private _originalTracers;
    private _originalTraceCallLlm;
    private _originalTraceToolCall;
    private _originalTraceMergedToolCalls;
    constructor(config?: GoogleADKInstrumentationConfig);
    protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[];
    manualPatch(adkModule: any): void;
    private _patchAll;
    /**
     * Replace ADK's internal tracers with PassthroughTracer to suppress
     * duplicate top-level spans (mirrors Python _disable_existing_tracers).
     */
    private _disableExistingTracers;
    /**
     * Wrap ADK's trace_call_llm to enrich the current span with OTel GenAI attributes.
     */
    private _wrapTraceCallLlm;
    /**
     * Wrap ADK's trace_tool_call to enrich the current span with tool attributes.
     */
    private _wrapTraceToolCall;
    /**
     * Wrap ADK's trace_merged_tool_calls to enrich the current span with merged tool attributes.
     */
    private _wrapTraceMergedToolCalls;
    /**
     * Patch LlmAgent constructor to create create_agent spans.
     */
    private _patchLlmAgent;
    /**
     * Patch Runner.run and Runner.runAsync (or run_async).
     */
    private _patchRunner;
    /**
     * Patch BaseAgent.runAsync (or run_async).
     */
    private _patchBaseAgent;
    /**
     * Attempt to resolve a nested submodule from the ADK exports.
     * ADK's JS package may organize exports differently from Python.
     */
    private _resolveSubmodule;
    private _unpatchAll;
}
