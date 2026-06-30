import {
  InstrumentationBase,
  InstrumentationModuleDefinition,
  InstrumentationNodeModuleDefinition,
  isWrapped,
} from '@opentelemetry/instrumentation';
import { InstrumentationConfig } from '@opentelemetry/instrumentation';
import { diag } from '@opentelemetry/api';
import { INSTRUMENTATION_PREFIX } from '../../constant';
import AssemblyAIWrapper from './wrapper';

export interface AssemblyAIInstrumentationConfig extends InstrumentationConfig {}

const TRANSCRIBE_METHODS = ['transcribe', 'submit', 'get'];

export default class OpenlitAssemblyAIInstrumentation extends InstrumentationBase {
  private _transcriptsProto: any = null;

  constructor(config: AssemblyAIInstrumentationConfig = {}) {
    super(`${INSTRUMENTATION_PREFIX}/instrumentation-assemblyai`, '1.0.0', config);
  }

  protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[] {
    const assemblyaiModule = new InstrumentationNodeModuleDefinition(
      'assemblyai',
      ['>=4.0.0'],
      (moduleExports, moduleVersion) => {
        this._patch(moduleExports, moduleVersion);
        return moduleExports;
      },
      (moduleExports) => {
        if (moduleExports !== undefined) {
          this._unpatch(moduleExports);
        }
      }
    );

    return [assemblyaiModule];
  }

  public manualPatch(assemblyai: any): void {
    this._patch(assemblyai);
  }

  protected _patch(moduleExports: any, moduleVersion?: string) {
    try {
      const OriginalAssemblyAIClient = moduleExports.AssemblyAI;
      if (!OriginalAssemblyAIClient || typeof OriginalAssemblyAIClient !== 'function') {
        return;
      }

      if (isWrapped(OriginalAssemblyAIClient)) {
        this._unwrap(moduleExports, 'AssemblyAI');
      }

      const tracer = this.tracer;
      const sdkVersion = moduleVersion ? String(moduleVersion) : undefined;

      // Capture instance helpers in closures so the wrapped constructor (a plain
      // function expression, required to carry the original's static surface)
      // never needs to alias `this`.
      const wrap = this._wrap.bind(this);
      const rememberTranscriptsProto = (proto: any) => {
        this._transcriptsProto = proto;
      };

      this._wrap(moduleExports, 'AssemblyAI', (original: (...args: any[]) => any) => {
        const WrappedAssemblyAI = function (this: any, ...clientArgs: any[]) {
          const client = new (original as any)(...clientArgs);

          if (client && client.transcripts) {
            const transcriptsProto = Object.getPrototypeOf(client.transcripts);
            if (transcriptsProto) {
              rememberTranscriptsProto(transcriptsProto);

              for (const methodName of TRANSCRIBE_METHODS) {
                if (
                  typeof transcriptsProto[methodName] === 'function' &&
                  !isWrapped(transcriptsProto[methodName])
                ) {
                  wrap(
                    transcriptsProto,
                    methodName,
                    AssemblyAIWrapper._patchTranscribe(tracer, methodName, sdkVersion)
                  );
                }
              }
            }
          }

          return client;
        };

        // Preserve the original constructor's static surface (static methods,
        // properties and metadata) so consumers relying on them still work.
        Object.setPrototypeOf(WrappedAssemblyAI, original);
        Object.assign(WrappedAssemblyAI, original);
        WrappedAssemblyAI.prototype = (original as any).prototype;

        return WrappedAssemblyAI;
      });
    } catch (e) {
      diag.error('assemblyai instrumentation: error in _patch method', e);
    }
  }

  protected _unpatch(moduleExports: any) {
    if (moduleExports.AssemblyAI) {
      this._unwrap(moduleExports, 'AssemblyAI');
    }
    if (this._transcriptsProto) {
      for (const methodName of TRANSCRIBE_METHODS) {
        if (isWrapped(this._transcriptsProto[methodName])) {
          this._unwrap(this._transcriptsProto, methodName);
        }
      }
    }
  }
}
