import { OpenlitConfigInterface, PricingObject } from './types';

export default class OpenlitConfig {
  static environment: OpenlitConfigInterface['environment'];
  static applicationName: OpenlitConfigInterface['applicationName'];
  static pricingInfo: PricingObject;
  static tracer: OpenlitConfigInterface['tracer'];
  static otlpEndpoint?: OpenlitConfigInterface['otlpEndpoint'];
  static otlpHeaders?: OpenlitConfigInterface['otlpHeaders'];
  static disableBatch?: OpenlitConfigInterface['disableBatch'];
  static captureMessageContent?: OpenlitConfigInterface['captureMessageContent'];
  static pricingJson?: OpenlitConfigInterface['pricingJson'];
  static disableMetrics?: boolean;
  static disableEvents?: boolean;
  static maxContentLength?: number | null;
  static customSpanAttributes?: Record<string, string> | null;

  static updateConfig({
    environment = 'default',
    applicationName = 'default',
    tracer,
    otlpEndpoint,
    otlpHeaders,
    disableBatch = false,
    captureMessageContent = true,
    pricingJson,
    disableMetrics = false,
    disableEvents = false,
    maxContentLength = null,
    customSpanAttributes = null,
  }: Partial<OpenlitConfigInterface> & {
    disableMetrics?: boolean;
    disableEvents?: boolean;
    maxContentLength?: number | null;
    customSpanAttributes?: Record<string, string> | null;
  }) {
    this.environment = environment;
    this.applicationName = applicationName;
    this.tracer = tracer as OpenlitConfigInterface['tracer'];
    this.otlpEndpoint = otlpEndpoint;
    this.otlpHeaders = otlpHeaders;
    this.disableBatch = disableBatch;
    this.captureMessageContent = captureMessageContent;
    this.pricingJson = pricingJson;
    this.disableMetrics = disableMetrics;
    this.disableEvents = disableEvents;
    this.maxContentLength = maxContentLength;
    this.customSpanAttributes = customSpanAttributes;
  }
}
