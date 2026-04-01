import {
  InstrumentationBase,
  InstrumentationModuleDefinition,
  InstrumentationNodeModuleDefinition,
  isWrapped,
} from '@opentelemetry/instrumentation';
import { InstrumentationConfig } from '@opentelemetry/instrumentation';
import { INSTRUMENTATION_PREFIX } from '../../constant';
import AzureAIInferenceWrapper from './wrapper';

export interface AzureAIInferenceInstrumentationConfig extends InstrumentationConfig {}

export default class OpenlitAzureAIInferenceInstrumentation extends InstrumentationBase {
  constructor(config: AzureAIInferenceInstrumentationConfig = {}) {
    super(`${INSTRUMENTATION_PREFIX}/instrumentation-azure-ai-inference`, '1.0.0', config);
  }

  protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[] {
    const module = new InstrumentationNodeModuleDefinition(
      '@azure-rest/ai-inference',
      ['>=1.0.0-beta.1'],
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

  public manualPatch(azureAIInference: any): void {
    this._patch(azureAIInference);
  }

  protected _patch(moduleExports: any) {
    try {
      if (!moduleExports.default || typeof moduleExports.default !== 'function') {
        return;
      }

      if (isWrapped(moduleExports.default)) {
        this._unwrap(moduleExports, 'default');
      }

      const tracer = this.tracer;

      this._wrap(moduleExports, 'default', (original: (...args: any[]) => any) => {
        return function (this: any, ...args: any[]) {
          const client = original.apply(this, args);

          const endpoint = typeof args[0] === 'string' ? args[0] : '';
          const { serverAddress, serverPort } =
            AzureAIInferenceWrapper.parseEndpoint(endpoint);

          if (client && typeof client.path === 'function') {
            const originalPath = client.path;
            client.path = function (...pathArgs: any[]) {
              const route: string = pathArgs[0];
              const handler = originalPath.apply(client, pathArgs);

              if (
                route === '/chat/completions' &&
                handler &&
                typeof handler.post === 'function'
              ) {
                const origPost = handler.post;
                handler.post = AzureAIInferenceWrapper._patchChatComplete(
                  tracer,
                  serverAddress,
                  serverPort
                )(origPost);
              } else if (
                route === '/embeddings' &&
                handler &&
                typeof handler.post === 'function'
              ) {
                const origPost = handler.post;
                handler.post = AzureAIInferenceWrapper._patchEmbeddings(
                  tracer,
                  serverAddress,
                  serverPort
                )(origPost);
              }

              return handler;
            };
          }

          return client;
        };
      });
    } catch (e) {
      console.error('Error in _patch method:', e);
    }
  }

  protected _unpatch(moduleExports: any) {
    if (moduleExports.default) {
      this._unwrap(moduleExports, 'default');
    }
  }
}
