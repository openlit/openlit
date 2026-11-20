/** GPU stats need a host process, so the edge build has none. */
export default class GpuMetricsCollector {
  async setup(_options: unknown): Promise<void> {}
}
