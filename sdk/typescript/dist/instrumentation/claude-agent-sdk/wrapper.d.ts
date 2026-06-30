/**
 * Claude Agent SDK wrapper — OTel GenAI semantic convention compliant.
 *
 * Wraps the `query()` async generator to produce `invoke_agent`, `execute_tool`,
 * and `chat` child spans. Tool spans are created via SDK hooks (PreToolUse /
 * PostToolUse / PostToolUseFailure). A message-based fallback handles cases
 * where hooks cannot be injected.
 *
 * Mirrors the Python SDK instrumentation in
 * sdk/python/src/openlit/instrumentation/claude_agent_sdk/.
 */
import { Tracer } from '@opentelemetry/api';
export declare function patchQuery(tracer: Tracer): (originalQuery: any) => any;
