import {
  InstrumentationBase,
  InstrumentationModuleDefinition,
  InstrumentationNodeModuleDefinition,
  isWrapped,
} from '@opentelemetry/instrumentation';
import { InstrumentationConfig } from '@opentelemetry/instrumentation';
import { INSTRUMENTATION_PREFIX } from '../../constant';
import AI21Wrapper from './wrapper';

export interface AI21InstrumentationConfig extends InstrumentationConfig {}

export default class OpenlitAI21Instrumentation extends InstrumentationBase {
  constructor(config: AI21InstrumentationConfig = {}) {
    super(`${INSTRUMENTATION_PREFIX}/instrumentation-ai21`, '1.0.0', config);
  }

  protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[] {
    const module = new InstrumentationNodeModuleDefinition(
      'ai21',
      ['>=1.0.0'],
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

  public manualPatch(ai21: any): void {
    this._patch(ai21);
  }

  protected _patch(moduleExports: any) {
    try {
      // AI21 exposes chat completions as `Completions.prototype.create` (a flat
      // top-level export, unlike groq-sdk's nested `Groq.Chat.Completions`).
      // Note: ai21's CJS bundle does not re-export its classes, so under CommonJS
      // `moduleExports` is empty and the guard below makes this a safe no-op. The
      // patch takes effect when the SDK is loaded as ESM (OTel's import hook) or
      // when the module is supplied via `manualPatch`.
      if (!moduleExports?.Completions?.prototype?.create) {
        return;
      }

      if (isWrapped(moduleExports.Completions.prototype.create)) {
        this._unwrap(moduleExports.Completions.prototype, 'create');
      }

      this._wrap(
        moduleExports.Completions.prototype,
        'create',
        AI21Wrapper._patchChatCompletionCreate(this.tracer)
      );

      // Conversational RAG is exported as `ConversationalRag` from ai21 and maps
      // to `ConversationalRag.prototype.create` (mirrors the Python SDK's
      // StudioConversationalRag.create). Guarded the same way as Completions so
      // it is a safe no-op when the SDK is loaded as CommonJS.
      if (moduleExports?.ConversationalRag?.prototype?.create) {
        if (isWrapped(moduleExports.ConversationalRag.prototype.create)) {
          this._unwrap(moduleExports.ConversationalRag.prototype, 'create');
        }

        this._wrap(
          moduleExports.ConversationalRag.prototype,
          'create',
          AI21Wrapper._patchConversationalRagCreate(this.tracer)
        );
      }
    } catch (e) {
      console.error('Error in _patch method:', e);
    }
  }

  protected _unpatch(moduleExports: any) {
    if (moduleExports?.Completions?.prototype?.create) {
      this._unwrap(moduleExports.Completions.prototype, 'create');
    }
    if (moduleExports?.ConversationalRag?.prototype?.create) {
      this._unwrap(moduleExports.ConversationalRag.prototype, 'create');
    }
  }
}
