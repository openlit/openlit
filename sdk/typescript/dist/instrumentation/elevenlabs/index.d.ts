import { InstrumentationBase, InstrumentationModuleDefinition } from '@opentelemetry/instrumentation';
import { InstrumentationConfig } from '@opentelemetry/instrumentation';
export interface ElevenLabsInstrumentationConfig extends InstrumentationConfig {
}
export default class OpenlitElevenLabsInstrumentation extends InstrumentationBase {
    private _textToSpeechProto;
    constructor(config?: ElevenLabsInstrumentationConfig);
    protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[];
    manualPatch(elevenlabs: any): void;
    protected _patch(moduleExports: any, moduleVersion?: string): void;
    protected _unpatch(moduleExports: any): void;
}
