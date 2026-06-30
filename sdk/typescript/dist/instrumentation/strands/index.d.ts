/**
 * OpenLIT Strands Agents Instrumentation
 *
 * Registers a StrandsSpanProcessor with the global TracerProvider to
 * enrich Strands' native OTel spans with OpenLIT attributes, content
 * capture, inference log events, and metrics -- without monkey-patching.
 *
 * Mirrors: sdk/python/src/openlit/instrumentation/strands/__init__.py
 */
import { InstrumentationBase, InstrumentationModuleDefinition } from '@opentelemetry/instrumentation';
import type { InstrumentationConfig } from '@opentelemetry/instrumentation';
export default class StrandsInstrumentation extends InstrumentationBase {
    private _processor;
    constructor(config?: InstrumentationConfig);
    protected init(): InstrumentationModuleDefinition | InstrumentationModuleDefinition[] | void;
    enable(): void;
    manualPatch(_moduleExports?: any): void;
    private _patch;
    private _registerProcessor;
    private _unpatch;
}
