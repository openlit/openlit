/**
 * OpenLIT Agno Framework Instrumentation
 *
 * Provides auto-instrumentation for the Agno agent framework (`agno` npm package):
 * - Agent construction   (Agent.__init__  -> create_agent spans)
 * - Agent execution      (Agent.run / arun -> invoke_agent spans)
 * - Tool execution       (FunctionCall.execute / aexecute -> execute_tool spans)
 * - Team execution       (Team.run / arun -> invoke_workflow spans)
 *
 * Mirrors: sdk/python/src/openlit/instrumentation/agno/__init__.py
 */

import {
  InstrumentationBase,
  InstrumentationModuleDefinition,
  InstrumentationNodeModuleDefinition,
  isWrapped,
} from '@opentelemetry/instrumentation';
import type { InstrumentationConfig } from '@opentelemetry/instrumentation';
import { INSTRUMENTATION_PREFIX } from '../../constant';
import AgnoWrapper from './wrapper';

const SUPPORTED_VERSIONS = ['>=0.6.0'];

export default class AgnoInstrumentation extends InstrumentationBase {
  constructor(config: InstrumentationConfig = {}) {
    super(`${INSTRUMENTATION_PREFIX}/instrumentation-agno`, '1.0.0', config);
  }

  protected init(): InstrumentationModuleDefinition | InstrumentationModuleDefinition[] | void {
    return new InstrumentationNodeModuleDefinition(
      'agno',
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
      const Agent = moduleExports?.Agent ?? moduleExports?.agent?.Agent;
      if (Agent?.prototype) {
        // create_agent: wrap constructor
        if (!Agent.prototype.__openlit_agno_init_patched) {
          const originalInit = Agent.prototype.__init__ ?? Agent.prototype.constructor;
          AgnoWrapper.patchAgentInit(Agent, tracer);
        }

        // invoke_agent: wrap run
        if (typeof Agent.prototype.run === 'function') {
          if (isWrapped(Agent.prototype.run)) this._unwrap(Agent.prototype, 'run');
          this._wrap(Agent.prototype, 'run', AgnoWrapper.patchAgentRun(tracer));
        }
        if (typeof Agent.prototype.arun === 'function') {
          if (isWrapped(Agent.prototype.arun)) this._unwrap(Agent.prototype, 'arun');
          this._wrap(Agent.prototype, 'arun', AgnoWrapper.patchAgentRun(tracer));
        }
      }

      // Patch Team
      const Team = moduleExports?.Team ?? moduleExports?.team?.Team;
      if (Team?.prototype) {
        if (typeof Team.prototype.run === 'function') {
          if (isWrapped(Team.prototype.run)) this._unwrap(Team.prototype, 'run');
          this._wrap(Team.prototype, 'run', AgnoWrapper.patchTeamRun(tracer));
        }
        if (typeof Team.prototype.arun === 'function') {
          if (isWrapped(Team.prototype.arun)) this._unwrap(Team.prototype, 'arun');
          this._wrap(Team.prototype, 'arun', AgnoWrapper.patchTeamRun(tracer));
        }
      }

      // Patch FunctionCall for tool execution spans
      const FunctionCall = moduleExports?.FunctionCall ?? moduleExports?.tools?.FunctionCall;
      if (FunctionCall?.prototype) {
        if (typeof FunctionCall.prototype.execute === 'function') {
          if (isWrapped(FunctionCall.prototype.execute)) this._unwrap(FunctionCall.prototype, 'execute');
          this._wrap(FunctionCall.prototype, 'execute', AgnoWrapper.patchToolExecute(tracer));
        }
        if (typeof FunctionCall.prototype.aexecute === 'function') {
          if (isWrapped(FunctionCall.prototype.aexecute)) this._unwrap(FunctionCall.prototype, 'aexecute');
          this._wrap(FunctionCall.prototype, 'aexecute', AgnoWrapper.patchToolExecute(tracer));
        }
      }
    } catch {
      /* graceful degradation */
    }
  }

  private _unpatch(moduleExports: any): void {
    try {
      const Agent = moduleExports?.Agent ?? moduleExports?.agent?.Agent;
      if (Agent?.prototype) {
        if (isWrapped(Agent.prototype.run)) this._unwrap(Agent.prototype, 'run');
        if (isWrapped(Agent.prototype.arun)) this._unwrap(Agent.prototype, 'arun');
      }
      const Team = moduleExports?.Team ?? moduleExports?.team?.Team;
      if (Team?.prototype) {
        if (isWrapped(Team.prototype.run)) this._unwrap(Team.prototype, 'run');
        if (isWrapped(Team.prototype.arun)) this._unwrap(Team.prototype, 'arun');
      }
      const FunctionCall = moduleExports?.FunctionCall ?? moduleExports?.tools?.FunctionCall;
      if (FunctionCall?.prototype) {
        if (isWrapped(FunctionCall.prototype.execute)) this._unwrap(FunctionCall.prototype, 'execute');
        if (isWrapped(FunctionCall.prototype.aexecute)) this._unwrap(FunctionCall.prototype, 'aexecute');
      }
    } catch { /* ignore */ }
  }
}
