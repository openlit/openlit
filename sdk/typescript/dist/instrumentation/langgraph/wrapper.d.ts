import { Tracer } from '@opentelemetry/api';
export default class LangGraphWrapper {
    /**
     * Wrap Pregel.prototype.invoke — creates an invoke_workflow span.
     */
    static _patchInvoke(tracer: Tracer): any;
    /**
     * Wrap Pregel.prototype.stream — creates an invoke_workflow span with stream mode.
     */
    static _patchStream(tracer: Tracer): any;
    /**
     * Wrap StateGraph.prototype.compile — creates a create_agent span.
     */
    static _patchCompile(tracer: Tracer): any;
    /**
     * Wrap StateGraph.prototype.addNode — wraps node callables
     * to create invoke_agent spans per node execution.
     */
    static _patchAddNode(tracer: Tracer): any;
}
