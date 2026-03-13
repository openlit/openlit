import {
  InstrumentationBase,
  InstrumentationModuleDefinition,
  InstrumentationNodeModuleDefinition,
  isWrapped,
} from '@opentelemetry/instrumentation';
import { InstrumentationConfig } from '@opentelemetry/instrumentation';
import { INSTRUMENTATION_PREFIX } from '../../constant';
import BedrockWrapper from './wrapper';

export interface BedrockInstrumentationConfig extends InstrumentationConfig {}

export default class OpenlitBedrockInstrumentation extends InstrumentationBase {
  constructor(config: BedrockInstrumentationConfig = {}) {
    super(`${INSTRUMENTATION_PREFIX}/instrumentation-bedrock`, '1.0.0', config);
  }

  protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[] {
    const module = new InstrumentationNodeModuleDefinition(
      '@aws-sdk/client-bedrock-runtime',
      ['>=3.0.0'],
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

  public manualPatch(bedrock: any): void {
    this._patch(bedrock);
  }

  protected _patch(moduleExports: any) {
    try {
      const BedrockRuntimeClient = moduleExports.BedrockRuntimeClient;
      if (!BedrockRuntimeClient?.prototype) return;

      if (isWrapped(BedrockRuntimeClient.prototype.send)) {
        this._unwrap(BedrockRuntimeClient.prototype, 'send');
      }

      this._wrap(
        BedrockRuntimeClient.prototype,
        'send',
        BedrockWrapper._patchSend(this.tracer)
      );
    } catch (e) {
      console.error('Error in Bedrock _patch method:', e);
    }
  }

  protected _unpatch(moduleExports: any) {
    try {
      const BedrockRuntimeClient = moduleExports.BedrockRuntimeClient;
      if (BedrockRuntimeClient?.prototype?.send) {
        this._unwrap(BedrockRuntimeClient.prototype, 'send');
      }
    } catch { /* ignore */ }
  }
}
