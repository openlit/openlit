import {
  InstrumentationBase,
  InstrumentationModuleDefinition,
  InstrumentationNodeModuleDefinition,
  isWrapped,
} from '@opentelemetry/instrumentation';
import { InstrumentationConfig } from '@opentelemetry/instrumentation';
import { INSTRUMENTATION_PREFIX } from '../../constant';
import GradientWrapper from './wrapper';

export interface GradientInstrumentationConfig extends InstrumentationConfig {}

export default class OpenlitGradientInstrumentation extends InstrumentationBase {
  constructor(config: GradientInstrumentationConfig = {}) {
    super(`${INSTRUMENTATION_PREFIX}/instrumentation-gradient`, '1.0.0', config);
  }

  protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[] {
    const module = new InstrumentationNodeModuleDefinition(
      '@digitalocean/gradient',
      // @digitalocean/gradient currently ships only as a prerelease (0.1.0-alpha.*).
      // A plain '>=0.1.0' range does NOT match prereleases under semver, so the hook
      // would load the module but silently skip patching. Anchor at the prerelease
      // tag (mirrors azure-ai-inference's '>=1.0.0-beta.1'); this still matches the
      // eventual stable 0.1.0 and later. See semver.satisfies prerelease semantics.
      ['>=0.1.0-alpha.0'],
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

  public manualPatch(gradient: any): void {
    this._patch(gradient);
  }

  protected _patch(moduleExports: any) {
    try {
      // The DigitalOcean Gradient SDK is Stainless-generated (OpenAI-shaped): the
      // top-level module only exports the `Gradient` client class, with resource
      // classes attached as static nested properties. Chat completions live at
      // `Gradient.Chat.Completions.prototype.create` (mirrors groq-sdk's
      // `Groq.Chat.Completions`, not ai21's flat top-level `Completions`).
      if (!moduleExports?.Gradient?.Chat?.Completions?.prototype?.create) {
        return;
      }

      if (isWrapped(moduleExports.Gradient.Chat.Completions.prototype.create)) {
        this._unwrap(moduleExports.Gradient.Chat.Completions.prototype, 'create');
      }

      this._wrap(
        moduleExports.Gradient.Chat.Completions.prototype,
        'create',
        GradientWrapper._patchChatCompletionCreate(this.tracer)
      );
    } catch (e) {
      console.error('Error in _patch method:', e);
    }
  }

  protected _unpatch(moduleExports: any) {
    if (moduleExports?.Gradient?.Chat?.Completions?.prototype?.create) {
      this._unwrap(moduleExports.Gradient.Chat.Completions.prototype, 'create');
    }
  }
}
