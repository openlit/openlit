/**
 * OpenLIT browser-use Framework Instrumentation
 *
 * Provides auto-instrumentation for the browser-use browser automation SDK:
 * - Agent.run   -> invoke_agent spans (full browser session)
 * - Agent.step  -> execute_tool spans  (individual browser action steps)
 *
 * Mirrors: sdk/python/src/openlit/instrumentation/browser_use/__init__.py
 */

import {
  InstrumentationBase,
  InstrumentationModuleDefinition,
  InstrumentationNodeModuleDefinition,
  isWrapped,
} from '@opentelemetry/instrumentation';
import type { InstrumentationConfig } from '@opentelemetry/instrumentation';
import { INSTRUMENTATION_PREFIX } from '../../constant';
import BrowserUseWrapper from './wrapper';

const SUPPORTED_VERSIONS = ['>=0.1.0'];

export default class BrowserUseInstrumentation extends InstrumentationBase {
  constructor(config: InstrumentationConfig = {}) {
    super(`${INSTRUMENTATION_PREFIX}/instrumentation-browser-use`, '1.0.0', config);
  }

  protected init(): InstrumentationModuleDefinition | InstrumentationModuleDefinition[] | void {
    return new InstrumentationNodeModuleDefinition(
      'browser-use',
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

      // Agent class may be at moduleExports.Agent or moduleExports.agent.Agent
      const Agent =
        moduleExports?.Agent ??
        moduleExports?.agent?.Agent ??
        moduleExports?.BrowserAgent;

      if (Agent?.prototype) {
        // invoke_agent: full browser task run
        if (typeof Agent.prototype.run === 'function') {
          if (isWrapped(Agent.prototype.run)) this._unwrap(Agent.prototype, 'run');
          this._wrap(Agent.prototype, 'run', BrowserUseWrapper.patchAgentRun(tracer));
        }

        // execute_tool: individual action step
        if (typeof Agent.prototype.step === 'function') {
          if (isWrapped(Agent.prototype.step)) this._unwrap(Agent.prototype, 'step');
          this._wrap(Agent.prototype, 'step', BrowserUseWrapper.patchAgentStep(tracer));
        }
      }
    } catch {
      /* graceful degradation — if the package shape changes we fail silently */
    }
  }

  private _unpatch(moduleExports: any): void {
    try {
      const Agent =
        moduleExports?.Agent ??
        moduleExports?.agent?.Agent ??
        moduleExports?.BrowserAgent;

      if (Agent?.prototype) {
        if (isWrapped(Agent.prototype.run)) this._unwrap(Agent.prototype, 'run');
        if (isWrapped(Agent.prototype.step)) this._unwrap(Agent.prototype, 'step');
      }
    } catch { /* ignore */ }
  }
}
