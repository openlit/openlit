"use strict";
/**
 * Cross-Language Trace Comparison Tests for Qdrant Integration
 *
 * Verifies TypeScript SDK trace attributes match Python SDK.
 *
 * Python SDK reference: sdk/python/src/openlit/instrumentation/qdrant/utils.py
 *
 * Key alignment:
 *   - db.system.name = 'qdrant'
 *   - db.operation.name: SEARCH, UPSERT, DELETE, GET
 *   - server.address, server.port (default localhost:6333)
 *   - db.vector.query.top_k for search
 *   - db.filter for filtered operations
 *   - db.vector.count for upsert
 *   - db.query.summary
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const wrapper_1 = __importDefault(require("../qdrant/wrapper"));
const config_1 = __importDefault(require("../../config"));
const helpers_1 = __importDefault(require("../../helpers"));
const semantic_convention_1 = __importDefault(require("../../semantic-convention"));
jest.mock('../../config');
jest.mock('../../helpers');
describe('Qdrant Cross-Language Trace Comparison', () => {
    let mockSpan;
    let mockTracer;
    beforeEach(() => {
        mockSpan = {
            setAttribute: jest.fn(),
            addEvent: jest.fn(),
            end: jest.fn(),
            setStatus: jest.fn(),
        };
        mockTracer = {
            startSpan: jest.fn().mockReturnValue(mockSpan),
        };
        config_1.default.environment = 'openlit-testing';
        config_1.default.applicationName = 'openlit-test';
        config_1.default.captureMessageContent = true;
        helpers_1.default.handleException = jest.fn();
    });
    afterEach(() => {
        jest.clearAllMocks();
    });
    // ── Common attributes ────────────────────────────────────────────────────
    it('should set db.system.name = "qdrant" matching Python DB_SYSTEM_QDRANT', async () => {
        const patchFn = wrapper_1.default._patchSearch(mockTracer);
        const originalMethod = jest.fn().mockResolvedValue([{ id: 1, score: 0.9 }]);
        const wrapped = patchFn(originalMethod);
        await wrapped.call({}, 'my_collection', { vector: [0.1, 0.2], limit: 5 });
        expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.DB_SYSTEM_NAME, 'qdrant');
    });
    it('should set server.address = localhost and server.port = 6333 (Python defaults)', async () => {
        const patchFn = wrapper_1.default._patchSearch(mockTracer);
        const originalMethod = jest.fn().mockResolvedValue([]);
        const wrapped = patchFn(originalMethod);
        await wrapped.call({}, 'col', { vector: [0.1], limit: 5 });
        expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.SERVER_ADDRESS, 'localhost');
        expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.SERVER_PORT, 6333);
    });
    // ── search → SEARCH ───────────────────────────────────────────────────────
    describe('search() → SEARCH (matches Python DB_OPERATION_SEARCH)', () => {
        async function runSearch(collectionName, params, returnValue = []) {
            const patchFn = wrapper_1.default._patchSearch(mockTracer);
            const originalMethod = jest.fn().mockResolvedValue(returnValue);
            const wrapped = patchFn(originalMethod);
            await wrapped.call({}, collectionName, params);
        }
        it('should set db.operation.name = "SEARCH"', async () => {
            await runSearch('my_col', { vector: [0.1, 0.2], limit: 10 });
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.DB_OPERATION_NAME, 'SEARCH');
        });
        it('should set db.collection.name', async () => {
            await runSearch('embeddings', { vector: [0.1], limit: 5 });
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.DB_COLLECTION_NAME, 'embeddings');
        });
        it('should set db.vector.query.top_k from limit param', async () => {
            await runSearch('col', { vector: [0.1], limit: 20 });
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.DB_VECTOR_QUERY_TOP_K, 20);
        });
        it('should set db.filter when filter provided', async () => {
            const filter = { must: [{ key: 'city', match: { value: 'Paris' } }] };
            await runSearch('col', { vector: [0.1], limit: 5, filter });
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.DB_FILTER, JSON.stringify(filter));
        });
        it('should set db.n_results to response array length', async () => {
            await runSearch('col', { vector: [0.1], limit: 5 }, [
                { id: 1, score: 0.9 },
                { id: 2, score: 0.8 },
            ]);
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.DB_N_RESULTS, 2);
        });
    });
    // ── upsert → UPSERT ───────────────────────────────────────────────────────
    describe('upsert() → UPSERT (matches Python DB_OPERATION_UPSERT)', () => {
        async function runUpsert(collectionName, params) {
            const patchFn = wrapper_1.default._patchUpsert(mockTracer);
            const originalMethod = jest.fn().mockResolvedValue({ status: 'completed' });
            const wrapped = patchFn(originalMethod);
            await wrapped.call({}, collectionName, params);
        }
        it('should set db.operation.name = "UPSERT"', async () => {
            await runUpsert('col', { points: [{ id: 1, vector: [0.1], payload: {} }] });
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.DB_OPERATION_NAME, 'UPSERT');
        });
        it('should set db.vector.count from points length', async () => {
            await runUpsert('col', {
                points: [
                    { id: 1, vector: [0.1] },
                    { id: 2, vector: [0.2] },
                    { id: 3, vector: [0.3] },
                ],
            });
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.DB_VECTOR_COUNT, 3);
        });
    });
    // ── delete → DELETE ───────────────────────────────────────────────────────
    describe('delete() → DELETE (matches Python DB_OPERATION_DELETE)', () => {
        async function runDelete(collectionName, params) {
            const patchFn = wrapper_1.default._patchDelete(mockTracer);
            const originalMethod = jest.fn().mockResolvedValue({ status: 'completed' });
            const wrapped = patchFn(originalMethod);
            await wrapped.call({}, collectionName, params);
        }
        it('should set db.operation.name = "DELETE"', async () => {
            await runDelete('col', { points: [1, 2] });
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.DB_OPERATION_NAME, 'DELETE');
        });
        it('should set db.ids_count from points array', async () => {
            await runDelete('col', { points: [1, 2, 3] });
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.DB_ID_COUNT, 3);
        });
        it('should set db.filter when filter provided', async () => {
            const filter = { must: [{ key: 'city', match: { value: 'London' } }] };
            await runDelete('col', { filter });
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.DB_FILTER, JSON.stringify(filter));
        });
    });
    // ── retrieve → GET ────────────────────────────────────────────────────────
    describe('retrieve() → GET (matches Python DB_OPERATION_GET)', () => {
        it('should set db.operation.name = "GET"', async () => {
            const patchFn = wrapper_1.default._patchRetrieve(mockTracer);
            const originalMethod = jest.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]);
            const wrapped = patchFn(originalMethod);
            await wrapped.call({}, 'col', { ids: [1, 2] });
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.DB_OPERATION_NAME, 'GET');
        });
        it('should set db.ids_count and db.response.returned_rows', async () => {
            const patchFn = wrapper_1.default._patchRetrieve(mockTracer);
            const originalMethod = jest.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]);
            const wrapped = patchFn(originalMethod);
            await wrapped.call({}, 'col', { ids: [1, 2] });
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.DB_ID_COUNT, 2);
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.DB_RESPONSE_RETURNED_ROWS, 2);
        });
    });
    // ── scroll → GET ─────────────────────────────────────────────────────────
    describe('scroll() → GET (matches Python DB_OPERATION_GET)', () => {
        it('should set db.operation.name = "GET"', async () => {
            const patchFn = wrapper_1.default._patchScroll(mockTracer);
            const originalMethod = jest.fn().mockResolvedValue({ points: [{ id: 1 }, { id: 2 }] });
            const wrapped = patchFn(originalMethod);
            await wrapped.call({}, 'col', { limit: 100 });
            expect(mockSpan.setAttribute).toHaveBeenCalledWith(semantic_convention_1.default.DB_OPERATION_NAME, 'GET');
        });
    });
    // ── Error handling ────────────────────────────────────────────────────────
    it('should call handleException and end span on error', async () => {
        const patchFn = wrapper_1.default._patchSearch(mockTracer);
        const error = new Error('Qdrant connection refused');
        const originalMethod = jest.fn().mockRejectedValue(error);
        const wrapped = patchFn(originalMethod);
        await expect(wrapped.call({}, 'col', { vector: [0.1], limit: 5 })).rejects.toThrow();
        expect(helpers_1.default.handleException).toHaveBeenCalledWith(mockSpan, error);
        expect(mockSpan.end).toHaveBeenCalled();
    });
});
//# sourceMappingURL=qdrant-trace-comparison.test.js.map