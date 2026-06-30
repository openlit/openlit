/**
 * Cursor SDK wrapper -- OTel GenAI semantic convention compliant.
 *
 * Wraps Agent.create(), Agent.resume(), and agent.send()
 * to produce `create_agent`, `invoke_agent`, and `execute_tool` spans.
 *
 * Agent.prompt() is NOT wrapped separately -- it internally calls
 * create() + send(), so the patched versions handle it automatically
 * without producing duplicate spans.
 *
 * Token usage is captured via onDelta injection (TurnEndedUpdate).
 * Tool call spans are created from SDKMessage stream events.
 * The `system` stream event provides resolved model and tool definitions.
 */
import { Tracer } from '@opentelemetry/api';
export declare function patchAgentCreate(tracer: Tracer): (originalCreate: any) => any;
export declare function patchAgentResume(tracer: Tracer): (originalResume: any) => any;
