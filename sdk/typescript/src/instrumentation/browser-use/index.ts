import {
  InstrumentationBase,
  InstrumentationModuleDefinition,
  InstrumentationNodeModuleDefinition,
  isWrapped,
} from '@opentelemetry/instrumentation';
import type { InstrumentationConfig } from '@opentelemetry/instrumentation';
import { diag } from '@opentelemetry/api';
import { INSTRUMENTATION_PREFIX } from '../../constant';
import BrowserUseWrapper from './wrapper';

const SUPPORTED_VERSIONS = ['>=0.1.0'];

export default class BrowserUseInstrumentation extends InstrumentationBase {
  constructor(config: InstrumentationConfig = {}) {
    super(`${INSTRUMENTATION_PREFIX}/instrumentation-browser-use`, '1.0.0', config);
  }

  protected init(): InstrumentationModuleDefinition | InstrumentationModuleDefinition[] | void {
    return [
      new InstrumentationNodeModuleDefinition(
        'browser-use',
        SUPPORTED_VERSIONS,
        (moduleExports: any, moduleVersion?: string) => {
          this._patch(moduleExports, moduleVersion);
          return moduleExports;
        },
        (moduleExports: any) => {
          if (moduleExports !== undefined) {
            this._unpatch(moduleExports);
          }
        }
      ),
      new InstrumentationNodeModuleDefinition(
        'browser-use/agent',
        SUPPORTED_VERSIONS,
        (moduleExports: any, moduleVersion?: string) => {
          this._patchAgent(moduleExports, moduleVersion);
          return moduleExports;
        },
        (moduleExports: any) => {
          if (moduleExports !== undefined) {
            this._unpatchAgent(moduleExports);
          }
        }
      ),
      new InstrumentationNodeModuleDefinition(
        'browser-use/controller',
        SUPPORTED_VERSIONS,
        (moduleExports: any, moduleVersion?: string) => {
          this._patchController(moduleExports, moduleVersion);
          return moduleExports;
        },
        (moduleExports: any) => {
          if (moduleExports !== undefined) {
            this._unpatchController(moduleExports);
          }
        }
      ),
    ];
  }

  public manualPatch(moduleExports: any): void {
    this._patch(moduleExports);
  }

  private _patch(moduleExports: any, moduleVersion?: string): void {
    this._patchAgent(moduleExports, moduleVersion);
    this._patchController(moduleExports, moduleVersion);
  }

  private _patchAgent(moduleExports: any, moduleVersion?: string): void {
    try {
      const AgentClass = moduleExports?.Agent ?? moduleExports?.default;
      const proto = AgentClass?.prototype;
      if (!proto || typeof proto.run !== 'function' || isWrapped(proto.run)) {
        return;
      }

      this._wrap(
        proto,
        'run',
        BrowserUseWrapper._patchAgentRun(this.tracer, moduleVersion ? String(moduleVersion) : undefined)
      );
    } catch (e) {
      diag.error('browser-use instrumentation: failed to patch Agent.run', e);
    }
  }

  private _patchController(moduleExports: any, moduleVersion?: string): void {
    try {
      const ControllerClass = moduleExports?.Controller ?? moduleExports?.default;
      const proto = ControllerClass?.prototype;
      if (!proto || typeof proto.act !== 'function' || isWrapped(proto.act)) {
        return;
      }

      this._wrap(
        proto,
        'act',
        BrowserUseWrapper._patchControllerAct(
          this.tracer,
          moduleVersion ? String(moduleVersion) : undefined
        )
      );
    } catch (e) {
      diag.error('browser-use instrumentation: failed to patch Controller.act', e);
    }
  }

  private _unpatch(moduleExports: any): void {
    this._unpatchAgent(moduleExports);
    this._unpatchController(moduleExports);
  }

  private _unpatchAgent(moduleExports: any): void {
    const AgentClass = moduleExports?.Agent ?? moduleExports?.default;
    const proto = AgentClass?.prototype;
    if (proto?.run && isWrapped(proto.run)) {
      this._unwrap(proto, 'run');
    }
  }

  private _unpatchController(moduleExports: any): void {
    const ControllerClass = moduleExports?.Controller ?? moduleExports?.default;
    const proto = ControllerClass?.prototype;
    if (proto?.act && isWrapped(proto.act)) {
      this._unwrap(proto, 'act');
    }
  }
}
