import OpenLitHelper from './helpers';

export default class OpenlitConfig {
  /**
   * A Singleton Configuration class for openLIT.
   *
   * This class maintains a single instance of configuration settings including
   * environment details, application name, and tracing information throughout the openLIT package.
   *
   * Attributes:
   *     environment (string): Deployment environment of the application.
   *     applicationName (string): Name of the application using openLIT.
   *     pricingInfo (Object): Pricing information.
   *     tracer (any): Tracer instance for OpenTelemetry.
   *     otlpEndpoint (string): Endpoint for OTLP.
   *     otlpHeaders (Object): Headers for OTLP.
   *     disableBatch (boolean): Flag to disable batch span processing in tracing.
   *     traceContent (boolean): Flag to enable or disable tracing of content.
   */

  static environment: string;
  static applicationName: string;
  static pricingInfo: any;
  static tracer: any;
  static metricsDict: any;
  static otlpEndpoint: string;
  static otlpHeaders: any;
  static disableBatch: boolean;
  static traceContent: any;
  static disableMetrics: boolean;
  static pricing_json: any;

  static resetToDefaults() {
    /** Resets configuration to default values. */
    this.environment = 'default';
    this.applicationName = 'default';
    this.pricingInfo = {};
    this.tracer = null;
    this.metricsDict = {};
    this.otlpEndpoint = '';
    this.otlpHeaders = '';
    this.disableBatch = false;
    this.traceContent = '';
    this.disableMetrics = false;
    this.pricing_json = '';
  }

  static async updatePricingJson(pricing_json: any) {
    try {
      const response = await OpenLitHelper.fetchPricingInfo(pricing_json);
      this.pricingInfo = response;
    } catch (e) {
      this.pricingInfo = {};
    }
    return this.pricingInfo;
  }

  static updateConfig({
    environment,
    applicationName,
    tracer,
    otlpEndpoint,
    otlpHeaders,
    disableBatch,
    traceContent,
    metricsDict = {},
    disableMetrics,
    pricing_json,
  }: any) {
    /**
     * Updates the configuration based on provided parameters.
     *
     * Args:
     *     environment (string): Deployment environment.
     *     applicationName (string): Application name.
     *     tracer: Tracer instance.
     *     otlpEndpoint (string): OTLP endpoint.
     *     otlpHeaders (Object): OTLP headers.
     *     disableBatch (boolean): Disable batch span processing flag.
     *     traceContent (boolean): Enable or disable content tracing.
     *     pricing_json (string): path or url to the pricing json file
     */

    this.environment = environment;
    this.applicationName = applicationName;
    this.tracer = tracer;
    this.metricsDict = metricsDict;
    this.otlpEndpoint = otlpEndpoint;
    this.otlpHeaders = otlpHeaders;
    this.disableBatch = disableBatch;
    this.traceContent = traceContent;
    this.disableMetrics = disableMetrics;
    this.pricing_json = pricing_json;
  }
}
