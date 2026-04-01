/**
 * OpenLIT Strands Agents Instrumentation
 *
 * Registers a StrandsSpanProcessor with the global TracerProvider to
 * enrich Strands' native OTel spans with OpenLIT attributes, content
 * capture, inference log events, and metrics -- without monkey-patching.
 *
 * Mirrors: sdk/python/src/openlit/instrumentation/strands/__init__.py
 */

import {
  InstrumentationBase,
  InstrumentationModuleDefinition,
  InstrumentationNodeModuleDefinition,
} from '@opentelemetry/instrumentation';
import type { InstrumentationConfig } from '@opentelemetry/instrumentation';
import { trace } from '@opentelemetry/api';

import { INSTRUMENTATION_PREFIX } from '../../constant';
import { StrandsSpanProcessor } from './processor';

const SUPPORTED_VERSIONS = ['>=0.1.0'];

export default class StrandsInstrumentation extends InstrumentationBase {
  private _processor: StrandsSpanProcessor | null = null;

  constructor(config: InstrumentationConfig = {}) {
    super(`${INSTRUMENTATION_PREFIX}/instrumentation-strands`, '1.0.0', config);
  }

  protected init(): InstrumentationModuleDefinition | InstrumentationModuleDefinition[] | void {
    return new InstrumentationNodeModuleDefinition(
      '@strands-agents/sdk',
      SUPPORTED_VERSIONS,
      (moduleExports: any) => {
        this._patch(moduleExports);
        return moduleExports;
      },
      (moduleExports: any) => {
        this._unpatch();
        return moduleExports;
      },
    );
  }

  public manualPatch(_moduleExports?: any): void {
    this._registerProcessor('unknown');
  }

  private _patch(moduleExports: any): void {
    try {
      let version = 'unknown';
      try {
        version = moduleExports?.version || 'unknown';
      } catch {
        // ignore
      }
      this._registerProcessor(version);
    } catch {
      // ignore
    }
  }

  private _registerProcessor(strandsVersion: string): void {
    if (this._processor) return;

    this._processor = new StrandsSpanProcessor(strandsVersion);

    const provider = trace.getTracerProvider() as any;
    const actual = provider._delegate || provider;

    // Try to prepend the processor (so it fires before exporters),
    // matching Python's _active_span_processor._span_processors prepend pattern.
    const activeProcessor = actual._activeSpanProcessor;
    if (activeProcessor && Array.isArray(activeProcessor._spanProcessors)) {
      activeProcessor._spanProcessors.unshift(this._processor);
    } else if (typeof actual.addSpanProcessor === 'function') {
      actual.addSpanProcessor(this._processor);
    }
  }

  private _unpatch(): void {
    if (this._processor) {
      try {
        this._processor.shutdown();
      } catch {
        // ignore
      }
      this._processor = null;
    }
  }
}
