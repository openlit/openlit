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
import { InstrumentationBase, InstrumentationModuleDefinition } from '@opentelemetry/instrumentation';
import type { InstrumentationConfig } from '@opentelemetry/instrumentation';
export default class ClaudeAgentSDKInstrumentation extends InstrumentationBase {
    private _originalQuery;
    private _wrappedQuery;
    constructor(config?: InstrumentationConfig);
    protected init(): InstrumentationModuleDefinition | InstrumentationModuleDefinition[] | void;
    manualPatch(moduleExports: any): any;
    private _patch;
    private _unpatch;
}
