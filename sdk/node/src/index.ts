import { Resource } from '@opentelemetry/resources';
import {
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT,
  SEMRESATTRS_SERVICE_NAME,
  SEMRESATTRS_TELEMETRY_SDK_NAME,
} from '@opentelemetry/semantic-conventions';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OpenlitOptions } from './types';
import Tracing from './tracing';
import { DEFAULT_APPLICATION_NAME, DEFAULT_ENVIRONMENT, SDK_NAME } from './constant';
import { SpanExporter } from '@opentelemetry/sdk-trace-base';
import Instrumentations from './instrumentation';
import OpenlitConfig from './config';

export default class Openlit {
  static resource: Resource;
  static options: OpenlitOptions;
  static _sdk: NodeSDK;
  static init(options?: OpenlitOptions) {
    try {
      const { environment = DEFAULT_ENVIRONMENT, applicationName = DEFAULT_APPLICATION_NAME } =
        options || {};

      const otlpEndpoint = options?.otlpEndpoint || process.env.OTEL_EXPORTER_OTLP_ENDPOINT || '';
      let otlpHeaders = options?.otlpHeaders;
      if (!otlpHeaders) {
        if (process.env.OTEL_EXPORTER_OTLP_HEADERS) {
          otlpHeaders = process.env.OTEL_EXPORTER_OTLP_HEADERS.split(',').reduce(
            (acc: Record<string, any>, items: string) => {
              const keyVal: string[] = items.split('=');
              acc[keyVal[0]] = keyVal[1];
              return acc;
            },
            {}
          );
        } else {
          otlpHeaders = {};
        }
      }

      this.options = options || {};
      this.options.otlpEndpoint = otlpEndpoint;
      this.options.otlpHeaders = otlpHeaders;

      this.resource = new Resource({
        [SEMRESATTRS_SERVICE_NAME]: applicationName,
        [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: environment,
        [SEMRESATTRS_TELEMETRY_SDK_NAME]: SDK_NAME,
      });

      Tracing.setup({
        ...options,
        environment,
        applicationName,
        otlpEndpoint,
        otlpHeaders,
        resource: this.resource,
      });

      this._sdk = new NodeSDK({
        resource: this.resource,
        traceExporter: Tracing.traceExporter as SpanExporter,
        // instrumentations: Instrumentations.getFilteredInstrumentations(disabledInstrumentations || []),
        // We should re-consider removing unrelevant spans here in the future
        // sampler: new TraceloopSampler(),
      });

      this._sdk.start();
    } catch (e) {
      console.log('Connection time out', e);
    }
  }
}
