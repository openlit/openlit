import { Tracer } from '@opentelemetry/api';
import { runWithFrameworkLlm } from '../../helpers';
import BaseWrapper from '../base-wrapper';
declare class OpenLITCallbackHandler {
    name: string;
    lc_serializable: boolean;
    awaitHandlers: boolean;
    private tracer;
    private spans;
    private skippedRuns;
    constructor(tracer: Tracer);
    private _getNameFromCallback;
    private _resolveParentRunId;
    private _getParentContext;
    private _createSpan;
    private _newHolder;
    private _setCommonAttributes;
    private _setModelParameters;
    private _endSpan;
    handleChainStart(chain: any, inputs: any, runId: string, parentRunId?: string, _tags?: string[], metadata?: any, _runType?: string, name?: string): void;
    handleChainEnd(outputs: any, runId: string): void;
    handleChainError(error: any, runId: string): void;
    handleChatModelStart(llm: any, messages: any[][], runId: string, parentRunId?: string, _extraParams?: any, _tags?: string[], metadata?: any, kwargs?: any): void;
    handleLLMStart(serialized: any, prompts: string[], runId: string, parentRunId?: string, _extraParams?: any, _tags?: string[], metadata?: any, kwargs?: any): void;
    handleLLMNewToken(token: string, _idx: any, runId: string, _chunk?: any): void;
    handleLLMEnd(output: any, runId: string): void;
    handleLLMError(error: any, runId: string): void;
    handleToolStart(tool: any, input: string, runId: string, parentRunId?: string, _tags?: string[], metadata?: any, kwargs?: any): void;
    handleToolEnd(output: any, runId: string): void;
    handleToolError(error: any, runId: string): void;
    handleRetrieverStart(retriever: any, query: string, runId: string, parentRunId?: string, _tags?: string[], metadata?: any, kwargs?: any): void;
    handleRetrieverEnd(documents: any[], runId: string): void;
    handleRetrieverError(error: any, runId: string): void;
    handleAgentAction(action: any, runId: string): void;
    handleAgentFinish(finish: any, runId: string): void;
}
declare class LangChainWrapper extends BaseWrapper {
    static _patchConfigure(tracer: Tracer): any;
}
export { OpenLITCallbackHandler, runWithFrameworkLlm };
export default LangChainWrapper;
