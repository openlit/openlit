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
import { InstrumentationBase, InstrumentationModuleDefinition } from '@opentelemetry/instrumentation';
import type { InstrumentationConfig } from '@opentelemetry/instrumentation';
export default class CursorSDKInstrumentation extends InstrumentationBase {
    constructor(config?: InstrumentationConfig);
    protected init(): InstrumentationModuleDefinition | InstrumentationModuleDefinition[] | void;
    manualPatch(moduleExports: any): any;
    private _patch;
    private _unpatch;
}
