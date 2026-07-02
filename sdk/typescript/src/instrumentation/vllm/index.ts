import {
  InstrumentationBase,
  InstrumentationModuleDefinition,
  InstrumentationNodeModuleDefinition,
  isWrapped,
} from '@opentelemetry/instrumentation';
import type { InstrumentationConfig } from '@opentelemetry/instrumentation';
import { diag } from '@opentelemetry/api';
import { INSTRUMENTATION_PREFIX } from '../../constant';
import OpenAIWrapper from '../openai/wrapper';
import VllmWrapper from './wrapper';

export interface VllmInstrumentationConfig extends InstrumentationConfig {
  /** Extra OpenAI client baseURL prefixes treated as vLLM (e.g. http://gpu-host:8080/v1). */
  baseUrlPrefixes?: string[];
}

export default class OpenlitVllmInstrumentation extends InstrumentationBase {
  constructor(config: VllmInstrumentationConfig = {}) {
    super(`${INSTRUMENTATION_PREFIX}/instrumentation-vllm`, '1.0.0', config);
    if (config.baseUrlPrefixes?.length) {
      VllmWrapper.baseUrlPrefixes = [
        ...VllmWrapper.defaultBaseUrlPrefixes,
        ...config.baseUrlPrefixes,
      ];
    }
  }

  protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[] {
    const module = new InstrumentationNodeModuleDefinition(
      'openai',
      ['>=3.1.0'],
      (moduleExports) => {
        this._patch(moduleExports);
        return moduleExports;
      },
      (moduleExports) => {
        if (moduleExports !== undefined) {
          this._unpatch(moduleExports);
        }
      },
    );
    return [module];
  }

  public manualPatch(openai: any): void {
    this._patch(openai);
  }

  protected _patch(moduleExports: any): void {
    try {
      const proto = moduleExports?.OpenAI?.Chat?.Completions?.prototype;
      if (!proto || typeof proto.create !== 'function') {
        diag.debug('vllm instrumentation: OpenAI.Chat.Completions.create not found');
        return;
      }

      let rawCreate = proto.create;
      if (isWrapped(rawCreate)) {
        this._unwrap(proto, 'create');
        rawCreate = proto.create;
      }

      const openaiHandler = OpenAIWrapper._patchChatCompletionCreate(this.tracer)(rawCreate);
      this._wrap(
        proto,
        'create',
        VllmWrapper._patchChat(this.tracer, openaiHandler, rawCreate),
      );
    } catch (e) {
      diag.error('vllm instrumentation: failed to patch OpenAI chat completions', e);
    }
  }

  protected _unpatch(moduleExports: any): void {
    try {
      const proto = moduleExports?.OpenAI?.Chat?.Completions?.prototype;
      if (proto?.create && isWrapped(proto.create)) {
        this._unwrap(proto, 'create');
      }
    } catch (e) {
      diag.error('vllm instrumentation: failed to unpatch OpenAI chat completions', e);
    }
  }
}
