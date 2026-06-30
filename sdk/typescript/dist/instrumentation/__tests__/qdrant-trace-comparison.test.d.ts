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
export {};
