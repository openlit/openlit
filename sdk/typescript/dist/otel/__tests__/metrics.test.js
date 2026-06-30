"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const metrics_1 = __importDefault(require("../metrics"));
const semantic_convention_1 = __importDefault(require("../../semantic-convention"));
const resources_1 = require("@opentelemetry/resources");
const setupOpts = {
    resource: (0, resources_1.defaultResource)(),
    otlpEndpoint: 'http://localhost:4318',
    environment: 'default',
    applicationName: 'default',
    disableBatch: false,
    captureMessageContent: true,
    disableMetrics: false,
    disableEvents: false,
};
describe('Metrics creation', () => {
    beforeEach(() => {
        metrics_1.default.resetForTesting();
        metrics_1.default.setup(setupOpts);
    });
    it('should create genaiClientUsageTokens histogram and allow record', () => {
        expect(metrics_1.default.genaiClientUsageTokens).toBeDefined();
        expect(typeof metrics_1.default.genaiClientUsageTokens.record).toBe('function');
        expect(() => metrics_1.default.genaiClientUsageTokens.record(42, { [semantic_convention_1.default.GEN_AI_PROVIDER_NAME]: 'openai' })).not.toThrow();
    });
    it('should create genaiClientOperationDuration histogram and allow record', () => {
        expect(metrics_1.default.genaiClientOperationDuration).toBeDefined();
        expect(typeof metrics_1.default.genaiClientOperationDuration.record).toBe('function');
        expect(() => metrics_1.default.genaiClientOperationDuration.record(1.23, { [semantic_convention_1.default.GEN_AI_PROVIDER_NAME]: 'openai' })).not.toThrow();
    });
    it('should create genaiCost histogram and allow record', () => {
        expect(metrics_1.default.genaiCost).toBeDefined();
        expect(typeof metrics_1.default.genaiCost.record).toBe('function');
        expect(() => metrics_1.default.genaiCost.record(0.99, { [semantic_convention_1.default.GEN_AI_PROVIDER_NAME]: 'openai' })).not.toThrow();
    });
});
//# sourceMappingURL=metrics.test.js.map