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

      this._wrap(moduleExports, 'AssemblyAI', (original: (...args: any[]) => any) => {
        return (...clientArgs: any[]) => {
          const client = new (original as any)(...clientArgs);

          if (client && client.transcripts) {
            const transcriptsProto = Object.getPrototypeOf(client.transcripts);
            if (transcriptsProto) {
              this._transcriptsProto = transcriptsProto;

              for (const methodName of TRANSCRIBE_METHODS) {
                if (
                  typeof transcriptsProto[methodName] === 'function' &&
                  !isWrapped(transcriptsProto[methodName])
                ) {
                  this._wrap(
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
