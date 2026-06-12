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

  private safeWrap(target: any, method: string, patcher: (tracer: any) => any): void {
    if (!target?.[method]) return;
    if (isWrapped(target[method])) {
      this._unwrap(target, method);
    }
    this._wrap(target, method, patcher(this.tracer));
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
      const Gradient = moduleExports?.Gradient;
      if (!Gradient) return;

      // Chat completions (inference)
      this.safeWrap(
        Gradient.Chat?.Completions?.prototype,
        'create',
        GradientWrapper._patchChatCompletionCreate
      );

      // Agent chat completions
      this.safeWrap(
        Gradient.Agents?.Chat?.Completions?.prototype,
        'create',
        GradientWrapper._patchAgentChatCompletionCreate
      );

      // Image generation
      this.safeWrap(
        Gradient.Images?.prototype,
        'generate',
        GradientWrapper._patchImageGenerate
      );
    } catch (e) {
      console.error('Error in _patch method:', e);
    }
  }

  protected _unpatch(moduleExports: any) {
    const Gradient = moduleExports?.Gradient;
    if (!Gradient) return;

    const targets: Array<[any, string]> = [
      [Gradient.Chat?.Completions?.prototype, 'create'],
      [Gradient.Agents?.Chat?.Completions?.prototype, 'create'],
      [Gradient.Images?.prototype, 'generate'],
    ];

    for (const [target, method] of targets) {
      if (target?.[method]) {
        this._unwrap(target, method);
      }
    }
  }
}
