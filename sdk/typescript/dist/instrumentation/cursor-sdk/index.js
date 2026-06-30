"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
const instrumentation_1 = require("@opentelemetry/instrumentation");
const constant_1 = require("../../constant");
const wrapper_1 = require("./wrapper");
const SUPPORTED_VERSIONS = ['>=0.1.0'];
class CursorSDKInstrumentation extends instrumentation_1.InstrumentationBase {
    constructor(config = {}) {
        super(`${constant_1.INSTRUMENTATION_PREFIX}/instrumentation-cursor-sdk`, '1.0.0', config);
    }
    init() {
        const module = new instrumentation_1.InstrumentationNodeModuleDefinition('@cursor/sdk', SUPPORTED_VERSIONS, (moduleExports) => {
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
            const AgentClass = moduleExports.Agent;
            if (!AgentClass)
                return moduleExports;
            if (typeof AgentClass.create === 'function') {
                const originalCreate = AgentClass.create;
                AgentClass.create = (0, wrapper_1.patchAgentCreate)(tracer)(originalCreate);
            }
            if (typeof AgentClass.resume === 'function') {
                const originalResume = AgentClass.resume;
                AgentClass.resume = (0, wrapper_1.patchAgentResume)(tracer)(originalResume);
            }
        }
        catch { /* graceful degradation */ }
        return moduleExports;
    }
    _unpatch(_moduleExports) {
        // InstrumentationBase handles restoring originals on disable
    }
}
exports.default = CursorSDKInstrumentation;
//# sourceMappingURL=index.js.map