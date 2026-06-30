import { Attributes } from '@opentelemetry/api';
export type GradientEndpointKind = 'inference' | 'agent';
/**
 * Walk the Gradient APIResource `_client` chain and read the per-route endpoint
 * from the root client (mirrors Python `_resolve_endpoint`).
 */
export declare function resolveGradientEndpoint(instance: any, kind: GradientEndpointKind): [string, number];
/** Extract agent UUID from `{uuid}.agents.do-ai.run` hostnames (Python parity). */
export declare function agentIdFromHost(host: string): string | undefined;
export declare function gradientSpanCreationAttrs(operationName: string, requestModel: string, serverAddress: string, serverPort: number): Attributes;
/** Normalize OpenAI-style stop sequences (Python `_normalize_stop`). */
export declare function normalizeStopSequences(stop: unknown): string[] | undefined;
/** Request attributes shared by chat and agent-chat surfaces. */
export declare function applyGradientChatRequestAttributes(span: any, body: Record<string, any>): void;
