"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const instrumentation_1 = require("@opentelemetry/instrumentation");
const api_1 = require("@opentelemetry/api");
const constant_1 = require("../../constant");
const utils_1 = require("./utils");
const wrapper_1 = require("./wrapper");
const config_1 = __importDefault(require("../../config"));
/**
 * OTel GenAI semantic convention compliant instrumentor for Google ADK.
 *
 * Monkey-patches Runner, BaseAgent, and LlmAgent from @google/adk.
 * Replaces ADK's internal tracers with PassthroughTracer to suppress
 * duplicate spans. Enriches ADK's LLM and tool spans with OTel attributes.
 */
class GoogleADKInstrumentation extends instrumentation_1.InstrumentationBase {
    constructor(config = {}) {
        super(`${constant_1.INSTRUMENTATION_PREFIX}/instrumentation-google-adk`, '1.0.0', config);
        this._registry = new wrapper_1.AgentCreationRegistry();
        this._originalTracers = {};
        this._originalTraceCallLlm = null;
        this._originalTraceToolCall = null;
        this._originalTraceMergedToolCalls = null;
    }
    init() {
        const module = new instrumentation_1.InstrumentationNodeModuleDefinition('@google/adk', ['>=1.2.0'], (moduleExports) => {
            this._patchAll(moduleExports);
            return moduleExports;
        }, (moduleExports) => {
            if (moduleExports !== undefined) {
                this._unpatchAll(moduleExports);
            }
        });
        return [module];
    }
    manualPatch(adkModule) {
        this._patchAll(adkModule);
    }
    // ---------------------------------------------------------------------------
    // Patching
    // ---------------------------------------------------------------------------
    _patchAll(moduleExports) {
        try {
            this._disableExistingTracers(moduleExports);
            this._wrapTraceCallLlm(moduleExports);
            this._wrapTraceToolCall(moduleExports);
            this._wrapTraceMergedToolCalls(moduleExports);
            this._patchLlmAgent(moduleExports);
            this._patchRunner(moduleExports);
            this._patchBaseAgent(moduleExports);
        }
        catch { /* graceful degradation */ }
    }
    /**
     * Replace ADK's internal tracers with PassthroughTracer to suppress
     * duplicate top-level spans (mirrors Python _disable_existing_tracers).
     */
    _disableExistingTracers(moduleExports) {
        try {
            const runners = this._resolveSubmodule(moduleExports, 'runners');
            if (runners && runners.tracer) {
                this._originalTracers['runners.tracer'] = runners.tracer;
                runners.tracer = new utils_1.PassthroughTracer(runners.tracer);
            }
        }
        catch { /* ignore */ }
        try {
            const baseAgentMod = this._resolveSubmodule(moduleExports, 'agents', 'base_agent') ??
                this._resolveSubmodule(moduleExports, 'agents');
            if (baseAgentMod && baseAgentMod.tracer) {
                this._originalTracers['base_agent.tracer'] = baseAgentMod.tracer;
                baseAgentMod.tracer = new utils_1.PassthroughTracer(baseAgentMod.tracer);
            }
        }
        catch { /* ignore */ }
    }
    /**
     * Wrap ADK's trace_call_llm to enrich the current span with OTel GenAI attributes.
     */
    _wrapTraceCallLlm(moduleExports) {
        try {
            const blfMod = this._resolveSubmodule(moduleExports, 'flows', 'llm_flows', 'base_llm_flow') ??
                this._resolveSubmodule(moduleExports, 'flows');
            if (!blfMod)
                return;
            const originalFn = blfMod.trace_call_llm ?? blfMod.traceCallLlm;
            if (!originalFn)
                return;
            this._originalTraceCallLlm = originalFn;
            const captureContent = () => config_1.default.captureMessageContent ?? true;
            const enriched = (...args) => {
                const result = originalFn(...args);
                try {
                    const span = api_1.trace.getActiveSpan();
                    if (span) {
                        const llmRequest = args[2];
                        const llmResponse = args[3];
                        (0, utils_1.enrichLlmSpan)(span, llmRequest, llmResponse, captureContent());
                    }
                }
                catch { /* ignore */ }
                return result;
            };
            if (blfMod.trace_call_llm) {
                blfMod.trace_call_llm = enriched;
            }
            else if (blfMod.traceCallLlm) {
                blfMod.traceCallLlm = enriched;
            }
        }
        catch { /* ignore */ }
    }
    /**
     * Wrap ADK's trace_tool_call to enrich the current span with tool attributes.
     */
    _wrapTraceToolCall(moduleExports) {
        try {
            const fnMod = this._resolveSubmodule(moduleExports, 'flows', 'llm_flows', 'functions') ??
                this._resolveSubmodule(moduleExports, 'flows');
            if (!fnMod)
                return;
            const originalFn = fnMod.trace_tool_call ?? fnMod.traceToolCall;
            if (!originalFn)
                return;
            this._originalTraceToolCall = originalFn;
            const captureContent = () => config_1.default.captureMessageContent ?? true;
            const enriched = (...args) => {
                const result = originalFn(...args);
                try {
                    const span = api_1.trace.getActiveSpan();
                    if (span) {
                        const tool = args[0];
                        const functionArgs = args[1];
                        const functionResponseEvent = args[2];
                        const toolError = args[3];
                        (0, utils_1.enrichToolSpan)(span, tool, functionArgs, functionResponseEvent, captureContent(), toolError);
                    }
                }
                catch { /* ignore */ }
                return result;
            };
            if (fnMod.trace_tool_call) {
                fnMod.trace_tool_call = enriched;
            }
            else if (fnMod.traceToolCall) {
                fnMod.traceToolCall = enriched;
            }
        }
        catch { /* ignore */ }
    }
    /**
     * Wrap ADK's trace_merged_tool_calls to enrich the current span with merged tool attributes.
     */
    _wrapTraceMergedToolCalls(moduleExports) {
        try {
            const fnMod = this._resolveSubmodule(moduleExports, 'flows', 'llm_flows', 'functions') ??
                this._resolveSubmodule(moduleExports, 'flows');
            if (!fnMod)
                return;
            const originalFn = fnMod.trace_merged_tool_calls ?? fnMod.traceMergedToolCalls;
            if (!originalFn)
                return;
            this._originalTraceMergedToolCalls = originalFn;
            const captureContent = () => config_1.default.captureMessageContent ?? true;
            const enriched = (...args) => {
                const result = originalFn(...args);
                try {
                    const span = api_1.trace.getActiveSpan();
                    if (span) {
                        const responseEventId = args[0];
                        const functionResponseEvent = args[1];
                        (0, utils_1.enrichMergedToolSpan)(span, responseEventId, functionResponseEvent, captureContent());
                    }
                }
                catch { /* ignore */ }
                return result;
            };
            if (fnMod.trace_merged_tool_calls) {
                fnMod.trace_merged_tool_calls = enriched;
            }
            else if (fnMod.traceMergedToolCalls) {
                fnMod.traceMergedToolCalls = enriched;
            }
        }
        catch { /* ignore */ }
    }
    /**
     * Patch LlmAgent constructor to create create_agent spans.
     */
    _patchLlmAgent(moduleExports) {
        try {
            const LlmAgent = moduleExports.LlmAgent ?? moduleExports.Agent;
            if (!LlmAgent?.prototype)
                return;
            const originalClass = LlmAgent;
            const patchFn = (0, wrapper_1.wrapAgentInit)(this.tracer, this._registry);
            // Wrap any init-like method if available; otherwise wrap the class prototype methods
            // ADK's LlmAgent may expose initialization through sub_agents, tools setters, etc.
            // The most reliable approach is patching the constructor via a proxy pattern.
            if (typeof originalClass === 'function') {
                const wrappedConstructor = patchFn(function (...args) {
                    return Reflect.construct(originalClass, args, new.target || originalClass);
                });
                // Copy static properties
                Object.setPrototypeOf(wrappedConstructor, originalClass);
                wrappedConstructor.prototype = originalClass.prototype;
                // ESM-to-CJS interop may define exports as getter-only properties;
                // both defineProperty and assignment may fail for ESM Module Namespace objects.
                const exportName = moduleExports.LlmAgent ? 'LlmAgent' : 'Agent';
                try {
                    Object.defineProperty(moduleExports, exportName, {
                        enumerable: true,
                        configurable: true,
                        writable: true,
                        value: wrappedConstructor,
                    });
                }
                catch {
                    try {
                        moduleExports[exportName] = wrappedConstructor;
                    }
                    catch { /* strict mode */ }
                }
            }
        }
        catch { /* ignore */ }
    }
    /**
     * Patch Runner.run and Runner.runAsync (or run_async).
     */
    _patchRunner(moduleExports) {
        try {
            const Runner = moduleExports.Runner;
            if (!Runner?.prototype)
                return;
            // Runner.run (sync)
            const runMethod = Runner.prototype.run;
            if (runMethod && !(0, instrumentation_1.isWrapped)(runMethod)) {
                this._wrap(Runner.prototype, 'run', (0, wrapper_1.wrapRunnerRun)(this.tracer, 'runner_run', this._registry));
            }
            // Runner.runAsync or Runner.run_async (async generator)
            const runAsyncName = Runner.prototype.runAsync ? 'runAsync' : 'run_async';
            const runAsyncMethod = Runner.prototype[runAsyncName];
            if (runAsyncMethod) {
                if ((0, instrumentation_1.isWrapped)(runAsyncMethod))
                    this._unwrap(Runner.prototype, runAsyncName);
                this._wrap(Runner.prototype, runAsyncName, (0, wrapper_1.wrapRunnerRunAsync)(this.tracer, 'runner_run_async', this._registry));
            }
            // Runner.runLive or Runner.run_live (async generator)
            const runLiveName = Runner.prototype.runLive ? 'runLive' : 'run_live';
            const runLiveMethod = Runner.prototype[runLiveName];
            if (runLiveMethod) {
                if ((0, instrumentation_1.isWrapped)(runLiveMethod))
                    this._unwrap(Runner.prototype, runLiveName);
                this._wrap(Runner.prototype, runLiveName, (0, wrapper_1.wrapRunnerRunAsync)(this.tracer, 'runner_run_live', this._registry));
            }
        }
        catch { /* ignore */ }
    }
    /**
     * Patch BaseAgent.runAsync (or run_async).
     */
    _patchBaseAgent(moduleExports) {
        try {
            const BaseAgent = moduleExports.BaseAgent;
            if (!BaseAgent?.prototype)
                return;
            const runAsyncName = BaseAgent.prototype.runAsync ? 'runAsync' : 'run_async';
            const runAsyncMethod = BaseAgent.prototype[runAsyncName];
            if (runAsyncMethod) {
                if ((0, instrumentation_1.isWrapped)(runAsyncMethod))
                    this._unwrap(BaseAgent.prototype, runAsyncName);
                this._wrap(BaseAgent.prototype, runAsyncName, (0, wrapper_1.wrapAgentRunAsync)(this.tracer, 'agent_run_async', this._registry));
            }
        }
        catch { /* ignore */ }
    }
    // ---------------------------------------------------------------------------
    // Submodule resolution
    // ---------------------------------------------------------------------------
    /**
     * Attempt to resolve a nested submodule from the ADK exports.
     * ADK's JS package may organize exports differently from Python.
     */
    _resolveSubmodule(moduleExports, ...path) {
        let current = moduleExports;
        for (const segment of path) {
            if (!current)
                return null;
            current = current[segment];
        }
        return current || null;
    }
    // ---------------------------------------------------------------------------
    // Unpatching
    // ---------------------------------------------------------------------------
    _unpatchAll(moduleExports) {
        try {
            // Restore original tracers
            if (this._originalTracers['runners.tracer']) {
                const runners = this._resolveSubmodule(moduleExports, 'runners');
                if (runners)
                    runners.tracer = this._originalTracers['runners.tracer'];
            }
            if (this._originalTracers['base_agent.tracer']) {
                const baseAgentMod = this._resolveSubmodule(moduleExports, 'agents', 'base_agent') ??
                    this._resolveSubmodule(moduleExports, 'agents');
                if (baseAgentMod)
                    baseAgentMod.tracer = this._originalTracers['base_agent.tracer'];
            }
            // Restore original tracing functions
            if (this._originalTraceCallLlm) {
                const blfMod = this._resolveSubmodule(moduleExports, 'flows', 'llm_flows', 'base_llm_flow') ??
                    this._resolveSubmodule(moduleExports, 'flows');
                if (blfMod) {
                    if (blfMod.trace_call_llm)
                        blfMod.trace_call_llm = this._originalTraceCallLlm;
                    else if (blfMod.traceCallLlm)
                        blfMod.traceCallLlm = this._originalTraceCallLlm;
                }
            }
            if (this._originalTraceToolCall) {
                const fnMod = this._resolveSubmodule(moduleExports, 'flows', 'llm_flows', 'functions') ??
                    this._resolveSubmodule(moduleExports, 'flows');
                if (fnMod) {
                    if (fnMod.trace_tool_call)
                        fnMod.trace_tool_call = this._originalTraceToolCall;
                    else if (fnMod.traceToolCall)
                        fnMod.traceToolCall = this._originalTraceToolCall;
                }
            }
            if (this._originalTraceMergedToolCalls) {
                const fnMod = this._resolveSubmodule(moduleExports, 'flows', 'llm_flows', 'functions') ??
                    this._resolveSubmodule(moduleExports, 'flows');
                if (fnMod) {
                    if (fnMod.trace_merged_tool_calls)
                        fnMod.trace_merged_tool_calls = this._originalTraceMergedToolCalls;
                    else if (fnMod.traceMergedToolCalls)
                        fnMod.traceMergedToolCalls = this._originalTraceMergedToolCalls;
                }
            }
            // Unwrap patched methods
            const Runner = moduleExports.Runner;
            if (Runner?.prototype) {
                if ((0, instrumentation_1.isWrapped)(Runner.prototype.run))
                    this._unwrap(Runner.prototype, 'run');
                const runAsyncName = Runner.prototype.runAsync ? 'runAsync' : 'run_async';
                if (Runner.prototype[runAsyncName] && (0, instrumentation_1.isWrapped)(Runner.prototype[runAsyncName])) {
                    this._unwrap(Runner.prototype, runAsyncName);
                }
                const runLiveName = Runner.prototype.runLive ? 'runLive' : 'run_live';
                if (Runner.prototype[runLiveName] && (0, instrumentation_1.isWrapped)(Runner.prototype[runLiveName])) {
                    this._unwrap(Runner.prototype, runLiveName);
                }
            }
            const BaseAgent = moduleExports.BaseAgent;
            if (BaseAgent?.prototype) {
                const runAsyncName = BaseAgent.prototype.runAsync ? 'runAsync' : 'run_async';
                if (BaseAgent.prototype[runAsyncName] && (0, instrumentation_1.isWrapped)(BaseAgent.prototype[runAsyncName])) {
                    this._unwrap(BaseAgent.prototype, runAsyncName);
                }
            }
        }
        catch { /* ignore */ }
    }
}
exports.default = GoogleADKInstrumentation;
//# sourceMappingURL=index.js.map