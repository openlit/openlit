import { OpenlitConfigInterface, PricingObject } from './types';
import type { Pipeline } from './guard/pipeline';
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
    static openlitApiKey?: string;
    static openlitUrl?: string;
    static guardPipeline?: Pipeline;
    static updateConfig({ environment, applicationName, tracer, otlpEndpoint, otlpHeaders, disableBatch, captureMessageContent, pricingJson, disableMetrics, disableEvents, maxContentLength, customSpanAttributes, openlitApiKey, openlitUrl, }: Partial<OpenlitConfigInterface> & {
        disableMetrics?: boolean;
        disableEvents?: boolean;
        maxContentLength?: number | null;
        customSpanAttributes?: Record<string, string> | null;
        openlitApiKey?: string;
        openlitUrl?: string;
    }): void;
}
