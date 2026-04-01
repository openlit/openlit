/**
 * OpenLIT Claude Agent SDK Instrumentation
 *
 * Provides auto-instrumentation for @anthropic-ai/claude-agent-sdk including:
 * - query() wrapping (invoke_agent spans)
 * - Tool execution spans via hooks (execute_tool)
 * - Chat child spans with usage (chat)
 * - Subagent spans (TaskStarted / TaskNotification)
 *
 * Mirrors the Python SDK instrumentation in
 * sdk/python/src/openlit/instrumentation/claude_agent_sdk/.
 */

import {
  InstrumentationBase,
  InstrumentationModuleDefinition,
  InstrumentationNodeModuleDefinition,
} from '@opentelemetry/instrumentation';
import type { InstrumentationConfig } from '@opentelemetry/instrumentation';

import { INSTRUMENTATION_PREFIX } from '../../constant';
import { patchQuery } from './wrapper';

const SUPPORTED_VERSIONS = ['>=0.1.0'];

export default class ClaudeAgentSDKInstrumentation extends InstrumentationBase {
  private _originalQuery: any = null;
  private _wrappedQuery: any = null;

  constructor(config: InstrumentationConfig = {}) {
    super(`${INSTRUMENTATION_PREFIX}/instrumentation-claude-agent-sdk`, '1.0.0', config);
  }

  protected init(): InstrumentationModuleDefinition | InstrumentationModuleDefinition[] | void {
    const self = this;
    const module = new InstrumentationNodeModuleDefinition(
      '@anthropic-ai/claude-agent-sdk',
      SUPPORTED_VERSIONS,
      (moduleExports: any) => {
        return self._patch(moduleExports);
      },
      (moduleExports: any) => {
        self._unpatch(moduleExports);
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

      if (typeof moduleExports.query === 'function') {
        this._originalQuery = moduleExports.query;
        const patcher = patchQuery(tracer);
        this._wrappedQuery = patcher(this._originalQuery);

        // Try Object.defineProperty, then direct assignment.
        // Both may fail for ESM Module Namespace objects (sealed + strict mode).
        try {
          Object.defineProperty(moduleExports, 'query', {
            enumerable: true,
            configurable: true,
            writable: true,
            value: this._wrappedQuery,
          });
        } catch {
          try { moduleExports.query = this._wrappedQuery; } catch { /* strict mode throws */ }
        }

        // ESM Module Namespace objects are immutable — assignments silently fail.
        // If the patch didn't take, return a Proxy that intercepts 'query' access.
        if (moduleExports.query !== this._wrappedQuery) {
          const wrappedQuery = this._wrappedQuery;
          return new Proxy(moduleExports, {
            get(target, prop, receiver) {
              if (prop === 'query') return wrappedQuery;
              return Reflect.get(target, prop, receiver);
            },
          });
        }
      }
    } catch { /* graceful degradation */ }
    return moduleExports;
  }

  private _unpatch(_moduleExports: any): void {
    this._originalQuery = null;
    this._wrappedQuery = null;
  }
}
