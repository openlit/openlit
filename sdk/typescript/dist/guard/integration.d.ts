/**
 * Auto-guard integration layer.
 *
 * setupAutoGuards wraps LLM provider methods so that guards run on every
 * call without any changes to existing instrumentation code.
 *
 * Call chain after setup:
 *
 *   User call
 *     -> Guard wrapper  (preflight -> may deny/redact)
 *       -> Instrumentor wrapper  (OTel telemetry)
 *         -> Original SDK method  (actual API call)
 *       <- Instrumentor wrapper
 *     <- Guard wrapper  (postflight -> may redact/warn)
 *   <- Returns to user
 *
 * **Streaming limitation**: postflight guards require a complete response
 * object with `choices[].message.content` (or equivalent). Streaming
 * responses yield incremental chunks that extractors cannot fully
 * reassemble, so postflight guards are silently skipped for streamed
 * completions. Preflight guards always run.
 *
 * Must stay in sync with: sdk/python/src/openlit/guard/_integration.py
 */
import { Guard } from './base';
export declare function extractOpenAIInput(kwargs: Record<string, any>): string;
export declare function extractOpenAIOutput(response: any): string;
export declare function extractAnthropicInput(kwargs: Record<string, any>): string;
export declare function extractAnthropicOutput(response: any): string;
export declare function extractGenericInput(kwargs: Record<string, any>): string;
export declare function extractGenericOutput(response: any): string;
export declare function setupAutoGuards(guards: Guard[], failOpen?: boolean): void;
