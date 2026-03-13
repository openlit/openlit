import {
  InstrumentationBase,
  InstrumentationModuleDefinition,
  InstrumentationNodeModuleDefinition,
  isWrapped,
} from '@opentelemetry/instrumentation';
import { InstrumentationConfig } from '@opentelemetry/instrumentation';
import { INSTRUMENTATION_PREFIX } from '../../constant';
import LlamaIndexWrapper from './wrapper';

export interface LlamaIndexInstrumentationConfig extends InstrumentationConfig {}

export default class OpenlitLlamaIndexInstrumentation extends InstrumentationBase {
  constructor(config: LlamaIndexInstrumentationConfig = {}) {
    super(`${INSTRUMENTATION_PREFIX}/instrumentation-llamaindex`, '1.0.0', config);
  }

  protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[] {
    const module = new InstrumentationNodeModuleDefinition(
      'llamaindex',
      ['>=0.3.0'],
      (moduleExports) => {
        this._patch(moduleExports);
        return moduleExports;
      },
      (moduleExports) => {
        if (moduleExports !== undefined) {
          this._unpatch(moduleExports);
        }
      }
    );
    return [module];
  }

  public manualPatch(llamaindex: any): void {
    this._patch(llamaindex);
  }

  protected _patch(moduleExports: any) {
    try {
      // Patch query engines
      const queryEngineClasses = [
        'RetrieverQueryEngine',
        'BaseQueryEngine',
        'QueryEngine',
      ];

      for (const className of queryEngineClasses) {
        const QueryEngineClass = moduleExports[className];
        if (QueryEngineClass?.prototype?.query) {
          if (isWrapped(QueryEngineClass.prototype.query)) {
            this._unwrap(QueryEngineClass.prototype, 'query');
          }
          this._wrap(
            QueryEngineClass.prototype,
            'query',
            LlamaIndexWrapper._patchQueryEngineQuery(this.tracer)
          );
          break; // Only patch the first one found to avoid duplicates
        }
      }

      // Patch chat engines
      const chatEngineClasses = [
        'ContextChatEngine',
        'SimpleChatEngine',
        'BaseChatEngine',
      ];

      for (const className of chatEngineClasses) {
        const ChatEngineClass = moduleExports[className];
        if (ChatEngineClass?.prototype?.chat) {
          if (isWrapped(ChatEngineClass.prototype.chat)) {
            this._unwrap(ChatEngineClass.prototype, 'chat');
          }
          this._wrap(
            ChatEngineClass.prototype,
            'chat',
            LlamaIndexWrapper._patchChatEngineChat(this.tracer)
          );
          break; // Only patch the first one found
        }
      }

      // Patch base LLM chat and complete methods for lower-level tracing
      const llmClasses = ['OpenAI', 'Anthropic', 'Ollama', 'LLM', 'BaseLLM'];
      for (const className of llmClasses) {
        const LLMClass = moduleExports[className];
        if (!LLMClass?.prototype) continue;

        if (LLMClass.prototype.chat && !isWrapped(LLMClass.prototype.chat)) {
          this._wrap(
            LLMClass.prototype,
            'chat',
            LlamaIndexWrapper._patchLLMChat(this.tracer)
          );
        }
        if (LLMClass.prototype.complete && !isWrapped(LLMClass.prototype.complete)) {
          this._wrap(
            LLMClass.prototype,
            'complete',
            LlamaIndexWrapper._patchLLMComplete(this.tracer)
          );
        }
      }
    } catch (e) {
      console.error('Error in LlamaIndex _patch method:', e);
    }
  }

  protected _unpatch(moduleExports: any) {
    try {
      const allClasses = [
        'RetrieverQueryEngine', 'BaseQueryEngine', 'QueryEngine',
        'ContextChatEngine', 'SimpleChatEngine', 'BaseChatEngine',
        'OpenAI', 'Anthropic', 'Ollama', 'LLM', 'BaseLLM',
      ];

      for (const className of allClasses) {
        const Cls = moduleExports[className];
        if (Cls?.prototype) {
          if (isWrapped(Cls.prototype.query)) this._unwrap(Cls.prototype, 'query');
          if (isWrapped(Cls.prototype.chat)) this._unwrap(Cls.prototype, 'chat');
          if (isWrapped(Cls.prototype.complete)) this._unwrap(Cls.prototype, 'complete');
        }
      }
    } catch { /* ignore */ }
  }
}
