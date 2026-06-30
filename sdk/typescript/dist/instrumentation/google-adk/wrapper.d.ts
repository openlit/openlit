import { Tracer, SpanContext } from '@opentelemetry/api';
export declare class AgentCreationRegistry {
    private _contexts;
    register(agentName: string, spanContext: SpanContext): void;
    get(agentName: string): SpanContext | undefined;
    getAll(): SpanContext[];
}
export declare function wrapAgentInit(tracer: Tracer, registry: AgentCreationRegistry): (originalMethod: (...args: any[]) => any) => (this: any, ...args: any[]) => any;
export declare function wrapRunnerRun(tracer: Tracer, endpoint: string, registry: AgentCreationRegistry): (originalMethod: (...args: any[]) => any) => (this: any, ...args: any[]) => any;
export declare function wrapRunnerRunAsync(tracer: Tracer, endpoint: string, registry: AgentCreationRegistry): (originalMethod: (...args: any[]) => any) => (this: any, ...args: any[]) => any;
export declare function wrapAgentRunAsync(tracer: Tracer, endpoint: string, registry: AgentCreationRegistry): (originalMethod: (...args: any[]) => any) => (this: any, ...args: any[]) => any;
