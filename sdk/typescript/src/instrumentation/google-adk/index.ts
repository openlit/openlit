import {
  InstrumentationBase,
  InstrumentationModuleDefinition,
  InstrumentationNodeModuleDefinition,
  isWrapped,
} from '@opentelemetry/instrumentation';
import { InstrumentationConfig } from '@opentelemetry/instrumentation';
import { trace } from '@opentelemetry/api';
import { INSTRUMENTATION_PREFIX } from '../../constant';
import {
  PassthroughTracer,
  enrichLlmSpan,
  enrichToolSpan,
  enrichMergedToolSpan,
} from './utils';
import {
  AgentCreationRegistry,
  wrapAgentInit,
  wrapRunnerRun,
  wrapRunnerRunAsync,
  wrapAgentRunAsync,
} from './wrapper';
import OpenlitConfig from '../../config';

export interface GoogleADKInstrumentationConfig extends InstrumentationConfig {}

/**
 * OTel GenAI semantic convention compliant instrumentor for Google ADK.
 *
 * Monkey-patches Runner, BaseAgent, and LlmAgent from @google/adk.
 * Replaces ADK's internal tracers with PassthroughTracer to suppress
 * duplicate spans. Enriches ADK's LLM and tool spans with OTel attributes.
 */
export default class GoogleADKInstrumentation extends InstrumentationBase {
  private _registry = new AgentCreationRegistry();
  private _originalTracers: Record<string, any> = {};
  private _originalTraceCallLlm: any = null;
  private _originalTraceToolCall: any = null;
  private _originalTraceMergedToolCalls: any = null;

  constructor(config: GoogleADKInstrumentationConfig = {}) {
    super(`${INSTRUMENTATION_PREFIX}/instrumentation-google-adk`, '1.0.0', config);
  }

  protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[] {
    const module = new InstrumentationNodeModuleDefinition(
      '@google/adk',
      ['>=1.2.0'],
      (moduleExports) => {
        this._patchAll(moduleExports);
        return moduleExports;
      },
      (moduleExports) => {
        if (moduleExports !== undefined) {
          this._unpatchAll(moduleExports);
        }
      }
    );

    return [module];
  }

  public manualPatch(adkModule: any): void {
    this._patchAll(adkModule);
  }

  // ---------------------------------------------------------------------------
  // Patching
  // ---------------------------------------------------------------------------

  private _patchAll(moduleExports: any): void {
    try {
      this._disableExistingTracers(moduleExports);
      this._wrapTraceCallLlm(moduleExports);
      this._wrapTraceToolCall(moduleExports);
      this._wrapTraceMergedToolCalls(moduleExports);
      this._patchLlmAgent(moduleExports);
      this._patchRunner(moduleExports);
      this._patchBaseAgent(moduleExports);
    } catch { /* graceful degradation */ }
  }

  /**
   * Replace ADK's internal tracers with PassthroughTracer to suppress
   * duplicate top-level spans (mirrors Python _disable_existing_tracers).
   */
  private _disableExistingTracers(moduleExports: any): void {
    try {
      const runners = this._resolveSubmodule(moduleExports, 'runners');
      if (runners && runners.tracer) {
        this._originalTracers['runners.tracer'] = runners.tracer;
        runners.tracer = new PassthroughTracer(runners.tracer);
      }
    } catch { /* ignore */ }

    try {
      const baseAgentMod = this._resolveSubmodule(moduleExports, 'agents', 'base_agent') ??
        this._resolveSubmodule(moduleExports, 'agents');
      if (baseAgentMod && baseAgentMod.tracer) {
        this._originalTracers['base_agent.tracer'] = baseAgentMod.tracer;
        baseAgentMod.tracer = new PassthroughTracer(baseAgentMod.tracer);
      }
    } catch { /* ignore */ }
  }

  /**
   * Wrap ADK's trace_call_llm to enrich the current span with OTel GenAI attributes.
   */
  private _wrapTraceCallLlm(moduleExports: any): void {
    try {
      const blfMod = this._resolveSubmodule(moduleExports, 'flows', 'llm_flows', 'base_llm_flow') ??
        this._resolveSubmodule(moduleExports, 'flows');
      if (!blfMod) return;

      const originalFn = blfMod.trace_call_llm ?? blfMod.traceCallLlm;
      if (!originalFn) return;

      this._originalTraceCallLlm = originalFn;
      const captureContent = () => OpenlitConfig.captureMessageContent ?? true;

      const enriched = (...args: any[]) => {
        const result = originalFn(...args);
        try {
          const span = trace.getActiveSpan();
          if (span) {
            const llmRequest = args[2];
            const llmResponse = args[3];
            enrichLlmSpan(span, llmRequest, llmResponse, captureContent());
          }
        } catch { /* ignore */ }
        return result;
      };

      if (blfMod.trace_call_llm) {
        blfMod.trace_call_llm = enriched;
      } else if (blfMod.traceCallLlm) {
        blfMod.traceCallLlm = enriched;
      }
    } catch { /* ignore */ }
  }

  /**
   * Wrap ADK's trace_tool_call to enrich the current span with tool attributes.
   */
  private _wrapTraceToolCall(moduleExports: any): void {
    try {
      const fnMod = this._resolveSubmodule(moduleExports, 'flows', 'llm_flows', 'functions') ??
        this._resolveSubmodule(moduleExports, 'flows');
      if (!fnMod) return;

      const originalFn = fnMod.trace_tool_call ?? fnMod.traceToolCall;
      if (!originalFn) return;

      this._originalTraceToolCall = originalFn;
      const captureContent = () => OpenlitConfig.captureMessageContent ?? true;

      const enriched = (...args: any[]) => {
        const result = originalFn(...args);
        try {
          const span = trace.getActiveSpan();
          if (span) {
            const tool = args[0];
            const functionArgs = args[1];
            const functionResponseEvent = args[2];
            const toolError = args[3];
            enrichToolSpan(span, tool, functionArgs, functionResponseEvent, captureContent(), toolError);
          }
        } catch { /* ignore */ }
        return result;
      };

      if (fnMod.trace_tool_call) {
        fnMod.trace_tool_call = enriched;
      } else if (fnMod.traceToolCall) {
        fnMod.traceToolCall = enriched;
      }
    } catch { /* ignore */ }
  }

  /**
   * Wrap ADK's trace_merged_tool_calls to enrich the current span with merged tool attributes.
   */
  private _wrapTraceMergedToolCalls(moduleExports: any): void {
    try {
      const fnMod = this._resolveSubmodule(moduleExports, 'flows', 'llm_flows', 'functions') ??
        this._resolveSubmodule(moduleExports, 'flows');
      if (!fnMod) return;

      const originalFn = fnMod.trace_merged_tool_calls ?? fnMod.traceMergedToolCalls;
      if (!originalFn) return;

      this._originalTraceMergedToolCalls = originalFn;
      const captureContent = () => OpenlitConfig.captureMessageContent ?? true;

      const enriched = (...args: any[]) => {
        const result = originalFn(...args);
        try {
          const span = trace.getActiveSpan();
          if (span) {
            const responseEventId = args[0];
            const functionResponseEvent = args[1];
            enrichMergedToolSpan(span, responseEventId, functionResponseEvent, captureContent());
          }
        } catch { /* ignore */ }
        return result;
      };

      if (fnMod.trace_merged_tool_calls) {
        fnMod.trace_merged_tool_calls = enriched;
      } else if (fnMod.traceMergedToolCalls) {
        fnMod.traceMergedToolCalls = enriched;
      }
    } catch { /* ignore */ }
  }

  /**
   * Patch LlmAgent constructor to create create_agent spans.
   */
  private _patchLlmAgent(moduleExports: any): void {
    try {
      const LlmAgent = moduleExports.LlmAgent ?? moduleExports.Agent;
      if (!LlmAgent?.prototype) return;

      const originalClass = LlmAgent;
      const patchFn = wrapAgentInit(this.tracer, this._registry);

      // Wrap any init-like method if available; otherwise wrap the class prototype methods
      // ADK's LlmAgent may expose initialization through sub_agents, tools setters, etc.
      // The most reliable approach is patching the constructor via a proxy pattern.
      if (typeof originalClass === 'function') {
        const wrappedConstructor = patchFn(function (this: any, ...args: any[]) {
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
        } catch {
          try { (moduleExports as any)[exportName] = wrappedConstructor; } catch { /* strict mode */ }
        }
      }
    } catch { /* ignore */ }
  }

  /**
   * Patch Runner.run and Runner.runAsync (or run_async).
   */
  private _patchRunner(moduleExports: any): void {
    try {
      const Runner = moduleExports.Runner;
      if (!Runner?.prototype) return;

      // Runner.run (sync)
      const runMethod = Runner.prototype.run;
      if (runMethod && !isWrapped(runMethod)) {
        this._wrap(
          Runner.prototype,
          'run',
          wrapRunnerRun(this.tracer, 'runner_run', this._registry)
        );
      }

      // Runner.runAsync or Runner.run_async (async generator)
      const runAsyncName = Runner.prototype.runAsync ? 'runAsync' : 'run_async';
      const runAsyncMethod = Runner.prototype[runAsyncName];
      if (runAsyncMethod) {
        if (isWrapped(runAsyncMethod)) this._unwrap(Runner.prototype, runAsyncName);
        this._wrap(
          Runner.prototype,
          runAsyncName,
          wrapRunnerRunAsync(this.tracer, 'runner_run_async', this._registry)
        );
      }

      // Runner.runLive or Runner.run_live (async generator)
      const runLiveName = Runner.prototype.runLive ? 'runLive' : 'run_live';
      const runLiveMethod = Runner.prototype[runLiveName];
      if (runLiveMethod) {
        if (isWrapped(runLiveMethod)) this._unwrap(Runner.prototype, runLiveName);
        this._wrap(
          Runner.prototype,
          runLiveName,
          wrapRunnerRunAsync(this.tracer, 'runner_run_live', this._registry)
        );
      }
    } catch { /* ignore */ }
  }

  /**
   * Patch BaseAgent.runAsync (or run_async).
   */
  private _patchBaseAgent(moduleExports: any): void {
    try {
      const BaseAgent = moduleExports.BaseAgent;
      if (!BaseAgent?.prototype) return;

      const runAsyncName = BaseAgent.prototype.runAsync ? 'runAsync' : 'run_async';
      const runAsyncMethod = BaseAgent.prototype[runAsyncName];
      if (runAsyncMethod) {
        if (isWrapped(runAsyncMethod)) this._unwrap(BaseAgent.prototype, runAsyncName);
        this._wrap(
          BaseAgent.prototype,
          runAsyncName,
          wrapAgentRunAsync(this.tracer, 'agent_run_async', this._registry)
        );
      }
    } catch { /* ignore */ }
  }

  // ---------------------------------------------------------------------------
  // Submodule resolution
  // ---------------------------------------------------------------------------

  /**
   * Attempt to resolve a nested submodule from the ADK exports.
   * ADK's JS package may organize exports differently from Python.
   */
  private _resolveSubmodule(moduleExports: any, ...path: string[]): any {
    let current = moduleExports;
    for (const segment of path) {
      if (!current) return null;
      current = current[segment];
    }
    return current || null;
  }

  // ---------------------------------------------------------------------------
  // Unpatching
  // ---------------------------------------------------------------------------

  private _unpatchAll(moduleExports: any): void {
    try {
      // Restore original tracers
      if (this._originalTracers['runners.tracer']) {
        const runners = this._resolveSubmodule(moduleExports, 'runners');
        if (runners) runners.tracer = this._originalTracers['runners.tracer'];
      }
      if (this._originalTracers['base_agent.tracer']) {
        const baseAgentMod = this._resolveSubmodule(moduleExports, 'agents', 'base_agent') ??
          this._resolveSubmodule(moduleExports, 'agents');
        if (baseAgentMod) baseAgentMod.tracer = this._originalTracers['base_agent.tracer'];
      }

      // Restore original tracing functions
      if (this._originalTraceCallLlm) {
        const blfMod = this._resolveSubmodule(moduleExports, 'flows', 'llm_flows', 'base_llm_flow') ??
          this._resolveSubmodule(moduleExports, 'flows');
        if (blfMod) {
          if (blfMod.trace_call_llm) blfMod.trace_call_llm = this._originalTraceCallLlm;
          else if (blfMod.traceCallLlm) blfMod.traceCallLlm = this._originalTraceCallLlm;
        }
      }
      if (this._originalTraceToolCall) {
        const fnMod = this._resolveSubmodule(moduleExports, 'flows', 'llm_flows', 'functions') ??
          this._resolveSubmodule(moduleExports, 'flows');
        if (fnMod) {
          if (fnMod.trace_tool_call) fnMod.trace_tool_call = this._originalTraceToolCall;
          else if (fnMod.traceToolCall) fnMod.traceToolCall = this._originalTraceToolCall;
        }
      }
      if (this._originalTraceMergedToolCalls) {
        const fnMod = this._resolveSubmodule(moduleExports, 'flows', 'llm_flows', 'functions') ??
          this._resolveSubmodule(moduleExports, 'flows');
        if (fnMod) {
          if (fnMod.trace_merged_tool_calls) fnMod.trace_merged_tool_calls = this._originalTraceMergedToolCalls;
          else if (fnMod.traceMergedToolCalls) fnMod.traceMergedToolCalls = this._originalTraceMergedToolCalls;
        }
      }

      // Unwrap patched methods
      const Runner = moduleExports.Runner;
      if (Runner?.prototype) {
        if (isWrapped(Runner.prototype.run)) this._unwrap(Runner.prototype, 'run');
        const runAsyncName = Runner.prototype.runAsync ? 'runAsync' : 'run_async';
        if (Runner.prototype[runAsyncName] && isWrapped(Runner.prototype[runAsyncName])) {
          this._unwrap(Runner.prototype, runAsyncName);
        }
        const runLiveName = Runner.prototype.runLive ? 'runLive' : 'run_live';
        if (Runner.prototype[runLiveName] && isWrapped(Runner.prototype[runLiveName])) {
          this._unwrap(Runner.prototype, runLiveName);
        }
      }

      const BaseAgent = moduleExports.BaseAgent;
      if (BaseAgent?.prototype) {
        const runAsyncName = BaseAgent.prototype.runAsync ? 'runAsync' : 'run_async';
        if (BaseAgent.prototype[runAsyncName] && isWrapped(BaseAgent.prototype[runAsyncName])) {
          this._unwrap(BaseAgent.prototype, runAsyncName);
        }
      }
    } catch { /* ignore */ }
  }
}
