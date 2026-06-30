"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
const instrumentation_1 = require("@opentelemetry/instrumentation");
const constant_1 = require("../../constant");
const wrapper_1 = require("./wrapper");
const SUPPORTED_VERSIONS = ['>=0.1.0'];
class ClaudeAgentSDKInstrumentation extends instrumentation_1.InstrumentationBase {
    constructor(config = {}) {
        super(`${constant_1.INSTRUMENTATION_PREFIX}/instrumentation-claude-agent-sdk`, '1.0.0', config);
        this._originalQuery = null;
        this._wrappedQuery = null;
    }
    init() {
        const module = new instrumentation_1.InstrumentationNodeModuleDefinition('@anthropic-ai/claude-agent-sdk', SUPPORTED_VERSIONS, (moduleExports) => {
            return this._patch(moduleExports);
        }, (moduleExports) => {
            this._unpatch(moduleExports);
            return moduleExports;
        });
        return module;
    }
    manualPatch(moduleExports) {
        return this._patch(moduleExports);
    }
    _patch(moduleExports) {
        try {
            const tracer = this.tracer;
            if (typeof moduleExports.query === 'function') {
                this._originalQuery = moduleExports.query;
                const patcher = (0, wrapper_1.patchQuery)(tracer);
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
                }
                catch {
                    try {
                        moduleExports.query = this._wrappedQuery;
                    }
                    catch { /* strict mode throws */ }
                }
                // ESM Module Namespace objects are immutable — assignments silently fail.
                // If the patch didn't take, return a Proxy that intercepts 'query' access.
                if (moduleExports.query !== this._wrappedQuery) {
                    const wrappedQuery = this._wrappedQuery;
                    return new Proxy(moduleExports, {
                        get(target, prop, receiver) {
                            if (prop === 'query')
                                return wrappedQuery;
                            return Reflect.get(target, prop, receiver);
                        },
                    });
                }
            }
        }
        catch { /* graceful degradation */ }
        return moduleExports;
    }
    _unpatch(_moduleExports) {
        this._originalQuery = null;
        this._wrappedQuery = null;
    }
}
exports.default = ClaudeAgentSDKInstrumentation;
//# sourceMappingURL=index.js.map