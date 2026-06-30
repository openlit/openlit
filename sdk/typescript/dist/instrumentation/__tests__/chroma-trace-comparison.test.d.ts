/**
 * Cross-Language Trace Comparison Tests for ChromaDB Integration
 *
 * Verifies that TypeScript SDK generates traces consistent with the Python SDK
 * for ChromaDB Collection operations.
 *
 * Python SDK reference: sdk/python/src/openlit/instrumentation/chroma/utils.py
 *
 * Key alignment:
 *   - db.system.name = 'chroma'
 *   - db.operation.name: INSERT (add), QUERY (query), GET (get), DELETE, PEEK, UPDATE, UPSERT
 *   - db.collection.name
 *   - server.address, server.port (default localhost:8000)
 *   - db.vector.query.top_k for query
 *   - db.filter for where-clause filtering
 *   - db.query.summary
 */
export {};
