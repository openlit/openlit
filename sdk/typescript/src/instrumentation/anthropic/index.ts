import {
  InstrumentationBase,
  InstrumentationModuleDefinition,
  InstrumentationNodeModuleDefinition,
  isWrapped,
} from '@opentelemetry/instrumentation';
import { InstrumentationConfig } from '@opentelemetry/instrumentation';
import { INSTRUMENTATION_PREFIX } from '../../constant';
import AnthropicWrapper from './wrapper';

const MESSAGES_ENDPOINT = 'anthropic.resources.messages';
const BETA_MESSAGES_ENDPOINT = 'anthropic.resources.beta.messages';

export interface AnthropicInstrumentationConfig extends InstrumentationConfig {}

export default class OpenlitAnthropicInstrumentation extends InstrumentationBase {
  constructor(config: AnthropicInstrumentationConfig = {}) {
    super(`${INSTRUMENTATION_PREFIX}/instrumentation-anthropic`, '1.0.0', config);
  }

  protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[] {
    const module = new InstrumentationNodeModuleDefinition(
      '@anthropic-ai/sdk',
      ['>= 0.21.0'],
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

  public manualPatch(anthropic: any): void {
    this._patch(anthropic);
  }

  /** Patch a single client, for code where the module itself cannot be reached. */
  public patchClient(client: any): void {
    for (const [resource, endpoint] of [
      [client?.messages, MESSAGES_ENDPOINT],
      [client?.beta?.messages, BETA_MESSAGES_ENDPOINT],
    ] as const) {
      const create = resource?.create;
      if (typeof create !== 'function' || isWrapped(create)) continue;
      this._wrap(resource, 'create', AnthropicWrapper._patchMessageCreate(this.tracer, endpoint));
      this._wrapStream(resource);
    }
  }

  // Pass-through: `stream()` starts the SDK's own call span before it reaches
  // `create()`, so that span has to be switched off here. The OpenLIT span still
  // comes from `create()`; a span here would make two per call.
  private _wrapStream(target: any) {
    if (typeof target.stream !== 'function' || isWrapped(target.stream)) return;
    this._wrap(target, 'stream', AnthropicWrapper._patchMessageStream());
  }

  private _targets(moduleExports: any): [any, string][] {
    // A namespace import has `.Anthropic`. A default import is the class itself,
    // and its own `.Anthropic` is the base class, which has no `.Messages`.
    const AnthropicClass = [moduleExports?.Anthropic, moduleExports, moduleExports?.default].find(
      (candidate) => candidate?.Messages?.prototype
    );
    if (!AnthropicClass) throw new Error('not the @anthropic-ai/sdk module');
    const targets: [any, string][] = [[AnthropicClass.Messages.prototype, MESSAGES_ENDPOINT]];
    // Beta arrived after the minimum supported SDK version.
    const betaMessages = AnthropicClass.Beta?.Messages?.prototype;
    if (typeof betaMessages?.create === 'function') {
      targets.push([betaMessages, BETA_MESSAGES_ENDPOINT]);
    }
    return targets;
  }

  protected _patch(moduleExports: any) {
    try {
      for (const [prototype, endpoint] of this._targets(moduleExports)) {
        if (isWrapped(prototype.create)) {
          this._unwrap(prototype, 'create');
        }
        this._wrap(prototype, 'create', AnthropicWrapper._patchMessageCreate(this.tracer, endpoint));
        if (isWrapped(prototype.stream)) {
          this._unwrap(prototype, 'stream');
        }
        this._wrapStream(prototype);
      }
    } catch (e) {
      console.error('Error in _patch method:', e);
    }
  }

  protected _unpatch(moduleExports: any) {
    for (const [prototype] of this._targets(moduleExports)) {
      this._unwrap(prototype, 'create');
      if (isWrapped(prototype.stream)) {
        this._unwrap(prototype, 'stream');
      }
    }
  }
}
