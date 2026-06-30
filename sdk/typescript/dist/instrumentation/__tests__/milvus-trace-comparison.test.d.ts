/**
 * Cross-Language Trace Comparison Tests for Milvus Integration
 *
 * Verifies TypeScript SDK trace attributes match Python SDK.
 *
 * Python SDK reference: sdk/python/src/openlit/instrumentation/milvus/milvus.py
 *
 * Key alignment:
 *   - db.system.name = 'milvus'
 *   - db.operation.name: SEARCH, INSERT, UPSERT, DELETE, QUERY
 *   - server.address, server.port (default localhost:19530)
 *   - db.vector.query.top_k for search
 *   - db.filter for expr/filter params
 *   - db.vector.count for insert/upsert
 *   - db.query.summary
 */
export {};
