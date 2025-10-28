import {
  InstrumentationBase,
  InstrumentationModuleDefinition,
  InstrumentationNodeModuleDefinition,
  isWrapped,
} from '@opentelemetry/instrumentation';
import { InstrumentationConfig } from '@opentelemetry/instrumentation';
import { INSTRUMENTATION_PREFIX } from '../../constant';
import MistralWrapper from './wrapper';

export interface MistralInstrumentationConfig extends InstrumentationConfig {}

export default class OpenlitMistralInstrumentation extends InstrumentationBase {
  constructor(config: MistralInstrumentationConfig = {}) {
    super(`${INSTRUMENTATION_PREFIX}/instrumentation-ai-mistral`, '1.0.0', config);
  }

  protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[] {
    const module = new InstrumentationNodeModuleDefinition(
      '@ai-sdk/mistral',
      ['>= 1.0.0'],
      (moduleExports) => {
        this._patch(moduleExports as any);
        return moduleExports;
      },
      (moduleExports) => {
        if (moduleExports !== undefined) {
          this._unpatch(moduleExports as any);
        }
      }
    );
    return [module];
  }

  public manualPatch(mistralModule: any): void {
    this._patch(mistralModule);
  }

  protected _patch(moduleExports: any) {
    try {
      // Wrap default provider function: mistral(modelId) -> LanguageModelV1
      if (isWrapped((moduleExports as any).mistral)) {
        (this as any)._unwrap(moduleExports as any, 'mistral' as any);
      }
      ;(this as any)._wrap(moduleExports as any, 'mistral' as any, (original: any) => {
        const tracer = this.tracer;
        return function wrappedMistral(this: any, ...args: any[]) {
          const model = original.apply(this, args);
          return MistralWrapper.wrapLanguageModel(model, tracer);
        };
      });

      // Wrap factory: createMistral(options) -> provider function
      if (isWrapped((moduleExports as any).createMistral)) {
        (this as any)._unwrap(moduleExports as any, 'createMistral' as any);
      }
      if (moduleExports.createMistral) {
        ;(this as any)._wrap(moduleExports as any, 'createMistral' as any, (original: any) => {
          const tracer = this.tracer;
          return function wrappedCreateMistral(this: any, ...args: any[]) {
            const provider = original.apply(this, args);
            return MistralWrapper.wrapProvider(provider, tracer);
          };
        });
      }

      // Also wrap provider methods on the default provider function object
      if (moduleExports.mistral) {
        const providerObj = moduleExports.mistral;
        if (isWrapped(providerObj.languageModel)) {
          (this as any)._unwrap(providerObj as any, 'languageModel' as any);
        }
        if (isWrapped(providerObj.chat)) {
          (this as any)._unwrap(providerObj as any, 'chat' as any);
        }
        if (isWrapped(providerObj.textEmbeddingModel)) {
          (this as any)._unwrap(providerObj as any, 'textEmbeddingModel' as any);
        }
        if (isWrapped(providerObj.embedding)) {
          (this as any)._unwrap(providerObj as any, 'embedding' as any);
        }

        ;(this as any)._wrap(providerObj as any, 'languageModel' as any, (original: any) => {
          const tracer = this.tracer;
          return function wrappedLanguageModel(this: any, ...args: any[]) {
            const model = original.apply(this, args);
            return MistralWrapper.wrapLanguageModel(model, tracer);
          };
        });
        if (providerObj.chat) {
          ;(this as any)._wrap(providerObj as any, 'chat' as any, (original: any) => {
            const tracer = this.tracer;
            return function wrappedChat(this: any, ...args: any[]) {
              const model = original.apply(this, args);
              return MistralWrapper.wrapLanguageModel(model, tracer);
            };
          });
        }
        if (providerObj.textEmbeddingModel) {
          ;(this as any)._wrap(providerObj as any, 'textEmbeddingModel' as any, (original: any) => {
            const tracer = this.tracer;
            return function wrappedEmbeddingModel(this: any, ...args: any[]) {
              const model = original.apply(this, args);
              return MistralWrapper.wrapEmbeddingModel(model, tracer);
            };
          });
        }
        if (providerObj.embedding) {
          ;(this as any)._wrap(providerObj as any, 'embedding' as any, (original: any) => {
            const tracer = this.tracer;
            return function wrappedEmbedding(this: any, ...args: any[]) {
              const model = original.apply(this, args);
              return MistralWrapper.wrapEmbeddingModel(model, tracer);
            };
          });
        }
      }
    } catch (e) {
      console.error('Error in _patch method:', e);
    }
  }

  protected _unpatch(moduleExports: any) {
    try { (this as any)._unwrap(moduleExports as any, 'mistral' as any); } catch {}
    try { (this as any)._unwrap(moduleExports as any, 'createMistral' as any); } catch {}
    try {
      const providerObj = moduleExports.mistral;
      if (providerObj) {
        try { (this as any)._unwrap(providerObj as any, 'languageModel' as any); } catch {}
        try { (this as any)._unwrap(providerObj as any, 'chat' as any); } catch {}
        try { (this as any)._unwrap(providerObj as any, 'textEmbeddingModel' as any); } catch {}
        try { (this as any)._unwrap(providerObj as any, 'embedding' as any); } catch {}
      }
    } catch {}
  }
}
