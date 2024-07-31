import { Meter } from '@opentelemetry/api';
// import { Instrumentation } from '@opentelemetry/instrumentation';
import { Resource } from '@opentelemetry/resources';
import { Tracer } from '@opentelemetry/sdk-trace-node';

export type InstrumentationType = 'openai';

export type OpenlitInstrumentations = Record<InstrumentationType, any>;

export type OpenlitOptions = {
  environment?: string;
  applicationName?: string;
  tracer?: Tracer;
  meter?: Meter;
  otlpEndpoint?: string;
  otlpHeaders?: Record<string, any>;
  disableBatch?: boolean;
  traceContent?: boolean;
  disabledInstrumentations?: string[];
  disableMetrics?: boolean;
  instrumentations?: OpenlitInstrumentations;
  pricing_json?: any;
};

export type SetupTracerOptions = OpenlitOptions & {
  resource: Resource;
};
