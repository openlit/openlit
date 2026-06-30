"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const resources_1 = require("@opentelemetry/resources");
const semantic_convention_1 = __importDefault(require("../../semantic-convention"));
const metrics_1 = __importDefault(require("../../otel/metrics"));
const base_wrapper_1 = __importDefault(require("../base-wrapper"));
const index_1 = __importDefault(require("../../index"));
describe('BaseWrapper.setBaseSpanAttributes', () => {
    let span;
    beforeEach(() => {
        index_1.default.init({
            applicationName: 'TestApp',
            environment: 'TestEnv',
            otlpEndpoint: 'http://localhost:4318',
        });
        metrics_1.default.resetForTesting();
        metrics_1.default.setup({ resource: (0, resources_1.defaultResource)(), otlpEndpoint: 'http://localhost:4318', environment: 'TestEnv', applicationName: 'TestApp', disableBatch: false, captureMessageContent: true, disableMetrics: false, disableEvents: false });
        jest.spyOn(metrics_1.default.genaiClientUsageTokens, 'record').mockImplementation(() => { });
        jest.spyOn(metrics_1.default.genaiClientOperationDuration, 'record').mockImplementation(() => { });
        jest.spyOn(metrics_1.default.genaiCost, 'record').mockImplementation(() => { });
        span = {
            setAttribute: jest.fn(),
            setStatus: jest.fn(),
            attributes: {
                [semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS]: 10,
                [semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS]: 20,
                duration: 1.5,
            },
        };
        Object.defineProperty(span, 'setAttributes', {
            value: jest.fn(),
            writable: true,
            configurable: true,
            enumerable: true,
        });
    });
    afterEach(() => {
        jest.restoreAllMocks();
    });
    it('should increment all metrics and set span attributes', () => {
        const baseAttributes = {
            model: 'gpt-4',
            user: 'user1',
            cost: 0.99,
            aiSystem: 'openai',
            genAIEndpoint: 'endpoint',
        };
        // @ts-expect-error: test mock span needs attributes property for metrics extraction
        base_wrapper_1.default.setBaseSpanAttributes(span, baseAttributes);
        base_wrapper_1.default.recordMetrics(span, baseAttributes);
        expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_REQUEST_USER, 'user1');
        expect(span.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.GEN_AI_USAGE_COST, 0.99);
        expect(span.setStatus).toHaveBeenCalled();
        expect(metrics_1.default.genaiClientUsageTokens.record).toHaveBeenCalledWith(10, expect.objectContaining({
            [semantic_convention_1.default.GEN_AI_TOKEN_TYPE]: semantic_convention_1.default.GEN_AI_TOKEN_TYPE_INPUT,
        }));
        expect(metrics_1.default.genaiClientUsageTokens.record).toHaveBeenCalledWith(20, expect.objectContaining({
            [semantic_convention_1.default.GEN_AI_TOKEN_TYPE]: semantic_convention_1.default.GEN_AI_TOKEN_TYPE_OUTPUT,
        }));
        expect(metrics_1.default.genaiClientOperationDuration.record).toHaveBeenCalledWith(1.5e-9, expect.any(Object));
        expect(metrics_1.default.genaiCost.record).toHaveBeenCalledWith(0.99, expect.any(Object));
    });
    it('should handle missing tokens and duration gracefully', () => {
        Object.defineProperty(span, 'attributes', {
            value: {},
            writable: true,
            configurable: true,
            enumerable: true,
        });
        const baseAttributes = {
            genAIEndpoint: 'endpoint',
            model: 'gpt-4',
            user: 'user2',
            cost: undefined,
            aiSystem: 'openai',
        };
        base_wrapper_1.default.setBaseSpanAttributes(span, baseAttributes);
        base_wrapper_1.default.recordMetrics(span, baseAttributes);
        expect(metrics_1.default.genaiClientUsageTokens.record).not.toHaveBeenCalled();
        expect(metrics_1.default.genaiClientOperationDuration.record).not.toHaveBeenCalled();
        expect(metrics_1.default.genaiCost.record).not.toHaveBeenCalled();
    });
    describe('metrics logic for inputTokens, outputTokens, duration, cost', () => {
        beforeEach(() => {
            metrics_1.default.resetForTesting();
            metrics_1.default.setup({ resource: (0, resources_1.defaultResource)(), otlpEndpoint: 'http://localhost:4318', environment: 'TestEnv', applicationName: 'TestApp', disableBatch: false, captureMessageContent: true, disableMetrics: false, disableEvents: false });
            jest.spyOn(metrics_1.default.genaiClientUsageTokens, 'record').mockImplementation(() => { });
            jest.spyOn(metrics_1.default.genaiClientOperationDuration, 'record').mockImplementation(() => { });
            jest.spyOn(metrics_1.default.genaiCost, 'record').mockImplementation(() => { });
        });
        it('should not call metrics for NaN, undefined, or non-number values', () => {
            const span = {
                setAttribute: jest.fn(),
                setStatus: jest.fn(),
                setAttributes: jest.fn(),
                attributes: {
                    [semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS]: NaN,
                    [semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS]: undefined,
                    duration: 'not-a-number',
                },
            };
            const baseAttributes = {
                model: 'gpt-4',
                user: 'user1',
                cost: 'not-a-number',
                aiSystem: 'openai',
                genAIEndpoint: 'endpoint',
            };
            base_wrapper_1.default.setBaseSpanAttributes(span, baseAttributes);
            base_wrapper_1.default.recordMetrics(span, baseAttributes);
            expect(metrics_1.default.genaiClientUsageTokens.record).not.toHaveBeenCalled();
            expect(metrics_1.default.genaiClientOperationDuration.record).not.toHaveBeenCalled();
            expect(metrics_1.default.genaiCost.record).not.toHaveBeenCalled();
        });
        it('should call metrics for zero and negative values', () => {
            const span = {
                setAttribute: jest.fn(),
                setStatus: jest.fn(),
                setAttributes: jest.fn(),
                attributes: {
                    [semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS]: 0,
                    [semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS]: -5,
                    duration: -1.5,
                },
            };
            const baseAttributes = {
                model: 'gpt-4',
                user: 'user1',
                cost: 0,
                aiSystem: 'openai',
                genAIEndpoint: 'endpoint',
            };
            base_wrapper_1.default.setBaseSpanAttributes(span, baseAttributes);
            base_wrapper_1.default.recordMetrics(span, baseAttributes);
            expect(metrics_1.default.genaiClientUsageTokens.record).toHaveBeenCalledWith(0, expect.objectContaining({
                [semantic_convention_1.default.GEN_AI_TOKEN_TYPE]: semantic_convention_1.default.GEN_AI_TOKEN_TYPE_INPUT,
            }));
            expect(metrics_1.default.genaiClientUsageTokens.record).toHaveBeenCalledWith(-5, expect.objectContaining({
                [semantic_convention_1.default.GEN_AI_TOKEN_TYPE]: semantic_convention_1.default.GEN_AI_TOKEN_TYPE_OUTPUT,
            }));
            expect(metrics_1.default.genaiClientOperationDuration.record).toHaveBeenCalledWith(-1.5e-9, expect.any(Object));
            expect(metrics_1.default.genaiCost.record).toHaveBeenCalledWith(0, expect.any(Object));
        });
        it('should convert string cost to number if possible', () => {
            const span = {
                setAttribute: jest.fn(),
                setStatus: jest.fn(),
                setAttributes: jest.fn(),
                attributes: {
                    [semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS]: 1,
                    [semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS]: 2,
                    duration: 3,
                },
            };
            const baseAttributes = {
                model: 'gpt-4',
                user: 'user1',
                cost: '1.23',
                aiSystem: 'openai',
                genAIEndpoint: 'endpoint',
            };
            base_wrapper_1.default.setBaseSpanAttributes(span, baseAttributes);
            base_wrapper_1.default.recordMetrics(span, baseAttributes);
            expect(metrics_1.default.genaiCost.record).toHaveBeenCalledWith(1.23, expect.any(Object));
        });
    });
});
//# sourceMappingURL=base-wrapper.test.js.map