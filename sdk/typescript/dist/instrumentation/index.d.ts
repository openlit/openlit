import { InstrumentationType, OpenlitInstrumentations } from '../types';
import { TracerProvider } from '@opentelemetry/api';
export default class Instrumentations {
    static availableInstrumentations: OpenlitInstrumentations;
    static setup(tracerProvider: TracerProvider, disabledInstrumentors?: string[], instrumentations?: OpenlitInstrumentations): void;
    static getFilteredInstrumentations(disabledInstrumentors: string[], instrumentations?: OpenlitInstrumentations): [InstrumentationType, any][];
}
