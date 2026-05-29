/**
 * OpenLIT Cursor SDK Instrumentation
 *
 * Provides auto-instrumentation for @cursor/sdk including:
 * - Agent.create() wrapping (create_agent spans + send() patching)
 * - Agent.resume() wrapping (send() patching on resumed agents)
 * - agent.send() wrapping (invoke_agent spans with streaming tool child spans)
 *
 * Agent.prompt() is covered automatically since it calls create() + send().
 *
 * OTel GenAI semantic convention compliant.
 */

import {
  InstrumentationBase,
  InstrumentationModuleDefinition,
  InstrumentationNodeModuleDefinition,
} from '@opentelemetry/instrumentation';
import type { InstrumentationConfig } from '@opentelemetry/instrumentation';

import { INSTRUMENTATION_PREFIX } from '../../constant';
import { patchAgentCreate, patchAgentResume } from './wrapper';

const SUPPORTED_VERSIONS = ['>=0.1.0'];

export default class CursorSDKInstrumentation extends InstrumentationBase {
  constructor(config: InstrumentationConfig = {}) {
    super(`${INSTRUMENTATION_PREFIX}/instrumentation-cursor-sdk`, '1.0.0', config);
  }

  protected init(): InstrumentationModuleDefinition | InstrumentationModuleDefinition[] | void {
    const module = new InstrumentationNodeModuleDefinition(
      '@cursor/sdk',
      SUPPORTED_VERSIONS,
      (moduleExports: any) => {
        return this._patch(moduleExports);
      },
      (moduleExports: any) => {
        this._unpatch(moduleExports);
        return moduleExports;
      },
    );
    return module;
  }

  public manualPatch(moduleExports: any): any {
    return this._patch(moduleExports);
  }

  private _patch(moduleExports: any): any {
    try {
      const tracer = this.tracer;
      const AgentClass = moduleExports.Agent;

      if (!AgentClass) return moduleExports;

      if (typeof AgentClass.create === 'function') {
        const originalCreate = AgentClass.create;
        AgentClass.create = patchAgentCreate(tracer)(originalCreate);
      }

      if (typeof AgentClass.resume === 'function') {
        const originalResume = AgentClass.resume;
        AgentClass.resume = patchAgentResume(tracer)(originalResume);
      }

    } catch { /* graceful degradation */ }
    return moduleExports;
  }

  private _unpatch(_moduleExports: any): void {
    // InstrumentationBase handles restoring originals on disable
  }
}
