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
import BaseOpenlit from './features/base';
import { Hallucination, Bias, ToxicityDetector, All } from './evals';

// Factory functions for evals
const evals = {
  Hallucination: (options: ConstructorParameters<typeof Hallucination>[0]) => new Hallucination(options),
  Bias: (options: ConstructorParameters<typeof Bias>[0]) => new Bias(options),
  ToxicityDetector: (options: ConstructorParameters<typeof ToxicityDetector>[0]) => new ToxicityDetector(options),
  All: (options: ConstructorParameters<typeof All>[0]) => new All(options),
};

class Openlit extends BaseOpenlit {
  static resource: Resource;
  static options: OpenlitOptions;
  static _sdk: NodeSDK;
  static evals = evals;
  static init(options?: OpenlitOptions) {
    try {
      const { environment = DEFAULT_ENVIRONMENT, applicationName = DEFAULT_APPLICATION_NAME } =
        options || {};

      const otlpEndpoint =
        options?.otlpEndpoint || process.env.OTEL_EXPORTER_OTLP_ENDPOINT || undefined;
      let otlpHeaders = options?.otlpHeaders;
      if (!otlpHeaders) {
        if (process.env.OTEL_EXPORTER_OTLP_HEADERS) {
          otlpHeaders = process.env.OTEL_EXPORTER_OTLP_HEADERS.split(',').reduce(
            (acc: Record<string, string>, items: string) => {
              const keyVal: string[] = items.split('=');
              acc[keyVal[0]] = keyVal[1];
              return acc;
            },
            {} as Record<string, string>
          );
        } else {
          otlpHeaders = {};
        }
      }

      this.options = options || {};
      this.options.otlpEndpoint = otlpEndpoint;
      this.options.otlpHeaders = otlpHeaders;
      this.options.disableBatch =
        options?.disableBatch === undefined ? true : !!options.disableBatch;

      this.resource = new Resource({
        [SEMRESATTRS_SERVICE_NAME]: applicationName,
        [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: environment,
        [SEMRESATTRS_TELEMETRY_SDK_NAME]: SDK_NAME,
      });

      Tracing.setup({
        ...this.options,
        environment,
        applicationName,
        otlpEndpoint,
        otlpHeaders,
        resource: this.resource,
      });

      this._sdk = new NodeSDK({
        resource: this.resource,
        traceExporter: Tracing.traceExporter as SpanExporter,
      });

      // This was causing the traceProvider initilization with multiple instances.
      // this._sdk.start();
    } catch (e) {
      console.log('Connection time out', e);
    }
  }
}

const openlit = Openlit as typeof Openlit & {
  evals: typeof evals;
};

export default openlit;
export { Openlit };
export type { OpenlitOptions } from './types';
