/**
 * OpenLIT Microsoft Agent Framework Instrumentation
 *
 * Provides auto-instrumentation for the Microsoft Agent Framework
 * (`agent-framework` npm package):
 * - Agent.__init__     -> create_agent spans
 * - Agent.run          -> invoke_agent spans
 * - FunctionTool.invoke -> execute_tool spans
 * - Workflow.run       -> invoke_workflow spans
 *
 * Mirrors: sdk/python/src/openlit/instrumentation/agent_framework/__init__.py
 */

import {
  InstrumentationBase,
  InstrumentationModuleDefinition,
  InstrumentationNodeModuleDefinition,
  isWrapped,
} from '@opentelemetry/instrumentation';
import type { InstrumentationConfig } from '@opentelemetry/instrumentation';
import { INSTRUMENTATION_PREFIX } from '../../constant';
import AgentFrameworkWrapper from './wrapper';

const SUPPORTED_VERSIONS = ['>=1.0.0-rc.1'];

export default class AgentFrameworkInstrumentation extends InstrumentationBase {
  constructor(config: InstrumentationConfig = {}) {
    super(`${INSTRUMENTATION_PREFIX}/instrumentation-agent-framework`, '1.0.0', config);
  }

  protected init(): InstrumentationModuleDefinition | InstrumentationModuleDefinition[] | void {
    return new InstrumentationNodeModuleDefinition(
      'agent-framework',
      SUPPORTED_VERSIONS,
      (moduleExports: any) => {
        this._patch(moduleExports);
        return moduleExports;
      },
      (moduleExports: any) => {
        this._unpatch(moduleExports);
        return moduleExports;
      },
    );
  }

  public manualPatch(moduleExports: any): void {
    this._patch(moduleExports);
  }

  private _patch(moduleExports: any): void {
    try {
      const tracer = this.tracer;

      // Patch Agent
      const Agent = moduleExports?.Agent ?? moduleExports?.agents?.Agent;
      if (Agent?.prototype) {
        // invoke_agent: Agent.run
        if (typeof Agent.prototype.run === 'function') {
          if (isWrapped(Agent.prototype.run)) this._unwrap(Agent.prototype, 'run');
          this._wrap(Agent.prototype, 'run', AgentFrameworkWrapper.patchAgentRun(tracer));
        }

        // create_agent: Agent.__init__ — attempted via constructor wrapping
        if (!Agent.prototype.__openlit_af_init_patched) {
          AgentFrameworkWrapper.patchAgentInit(Agent, tracer);
        }
      }

      // Patch FunctionTool (execute_tool spans)
      const FunctionTool =
        moduleExports?.FunctionTool ??
        moduleExports?.tools?.FunctionTool ??
        moduleExports?._tools?.FunctionTool;

      if (FunctionTool?.prototype) {
        if (typeof FunctionTool.prototype.invoke === 'function') {
          if (isWrapped(FunctionTool.prototype.invoke)) this._unwrap(FunctionTool.prototype, 'invoke');
          this._wrap(FunctionTool.prototype, 'invoke', AgentFrameworkWrapper.patchToolInvoke(tracer));
        }
      }

      // Patch Workflow (invoke_workflow spans)
      const Workflow =
        moduleExports?.Workflow ??
        moduleExports?._workflows?.Workflow ??
        moduleExports?.workflows?.Workflow;

      if (Workflow?.prototype) {
        if (typeof Workflow.prototype.run === 'function') {
          if (isWrapped(Workflow.prototype.run)) this._unwrap(Workflow.prototype, 'run');
          this._wrap(Workflow.prototype, 'run', AgentFrameworkWrapper.patchWorkflowRun(tracer));
        }
      }
    } catch {
      /* graceful degradation */
    }
  }

  private _unpatch(moduleExports: any): void {
    try {
      const Agent = moduleExports?.Agent ?? moduleExports?.agents?.Agent;
      if (Agent?.prototype) {
        if (isWrapped(Agent.prototype.run)) this._unwrap(Agent.prototype, 'run');
      }
      const FunctionTool =
        moduleExports?.FunctionTool ??
        moduleExports?.tools?.FunctionTool ??
        moduleExports?._tools?.FunctionTool;
      if (FunctionTool?.prototype) {
        if (isWrapped(FunctionTool.prototype.invoke)) this._unwrap(FunctionTool.prototype, 'invoke');
      }
      const Workflow =
        moduleExports?.Workflow ??
        moduleExports?._workflows?.Workflow ??
        moduleExports?.workflows?.Workflow;
      if (Workflow?.prototype) {
        if (isWrapped(Workflow.prototype.run)) this._unwrap(Workflow.prototype, 'run');
      }
    } catch { /* ignore */ }
  }
}
