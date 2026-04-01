/**
 * OpenLIT Mastra Instrumentation
 *
 * Uses a SpanProcessor to enrich Mastra's native OTel spans (created
 * by @mastra/otel-bridge) with OpenLIT attributes, content capture,
 * inference log events, and metrics -- without any monkey-patching.
 *
 * Mirrors the Python Strands instrumentation pattern:
 *   sdk/python/src/openlit/instrumentation/strands/__init__.py
 */

import {
  InstrumentationBase,
  InstrumentationModuleDefinition,
  InstrumentationNodeModuleDefinition,
} from '@opentelemetry/instrumentation';
import type { InstrumentationConfig } from '@opentelemetry/instrumentation';
import { trace } from '@opentelemetry/api';

import { INSTRUMENTATION_PREFIX } from '../../constant';
import OpenlitConfig from '../../config';
import { MastraSpanProcessor } from './processor';

const SUPPORTED_VERSIONS = ['>=1.0.0'];

export default class MastraInstrumentation extends InstrumentationBase {
  private _processor: MastraSpanProcessor | null = null;

  constructor(config: InstrumentationConfig = {}) {
    super(
      `${INSTRUMENTATION_PREFIX}/instrumentation-mastra`,
      '1.0.0',
      config
    );
  }

  protected init():
    | InstrumentationModuleDefinition
    | InstrumentationModuleDefinition[]
    | void {
    return new InstrumentationNodeModuleDefinition(
      '@mastra/core',
      SUPPORTED_VERSIONS,
      (moduleExports: any) => {
        this._registerProcessor();
        return moduleExports;
      },
      () => {
        this._unregisterProcessor();
      }
    );
  }

  public manualPatch(_moduleExports: any): void {
    this._registerProcessor();
  }

  private _registerProcessor(): void {
    if (this._processor) return;

    this._processor = new MastraSpanProcessor();

    // Use OpenlitConfig.tracer (SDK TracerProvider) with fallback
    const provider = (OpenlitConfig.tracer || trace.getTracerProvider()) as any;
    if (!provider) return;

    // Prepend processor so enriched attributes are present before export
    // (same pattern as Python Strands __init__.py)
    const multi = provider._activeSpanProcessor;
    if (multi && Array.isArray(multi._spanProcessors)) {
      try {
        multi._spanProcessors = [this._processor, ...multi._spanProcessors];
        return;
      } catch {
        // fall through to addSpanProcessor
      }
    }

    if (typeof provider.addSpanProcessor === 'function') {
      provider.addSpanProcessor(this._processor);
    }
  }

  private _unregisterProcessor(): void {
    if (this._processor) {
      this._processor.shutdown().catch(() => {});
      this._processor = null;
    }
  }
}
