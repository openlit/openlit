import { logs } from '@opentelemetry/api-logs';
import { LoggerProvider } from '@opentelemetry/sdk-logs';
import { SetupEventsOptions } from '../types';
export default class Events {
    static loggerProvider: LoggerProvider;
    static logger: ReturnType<typeof logs.getLogger>;
    static setup(options: SetupEventsOptions): import("@opentelemetry/api-logs").Logger | null;
    private static buildLoggerProvider;
    private static createOTLPProcessor;
    static resetForTesting(): void;
}
