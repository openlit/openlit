import { execFile } from 'child_process';

/**
 * GPU stats collection for the JS SDK.
 *
 * Unlike the Python SDK (which binds NVML via `pynvml`/`amdsmi`), the JS SDK
 * shells out to the `nvidia-smi` CLI — as suggested in the feature request —
 * so there is no native dependency to build. A single `--query-gpu` call
 * returns every metric we need for all GPUs at once, which we parse here.
 *
 * Everything in this file is pure/dependency-injectable so it can be unit
 * tested without a real GPU.
 */

/**
 * `nvidia-smi --query-gpu` fields, in order. The parser relies on this order.
 * The trailing 10 fields are always numeric; only `name` (index 2) may contain
 * commas, so the parser reconstructs it from whatever sits between the two
 * fixed-width ends.
 */
export const NVIDIA_SMI_FIELDS = [
  'index',
  'uuid',
  'name',
  'utilization.gpu',
  'utilization.encoder',
  'utilization.decoder',
  'temperature.gpu',
  'fan.speed',
  'memory.free',
  'memory.total',
  'memory.used',
  'power.draw',
  'power.limit',
] as const;

/** Number of trailing numeric columns (everything after `name`). */
const NUMERIC_COLS = NVIDIA_SMI_FIELDS.length - 3;

export interface GpuStatsRow {
  index: string;
  uuid: string;
  name: string;
  utilization: number;
  utilizationEnc: number;
  utilizationDec: number;
  temperature: number;
  fanSpeed: number;
  memoryFree: number;
  memoryTotal: number;
  memoryUsed: number;
  powerDraw: number;
  powerLimit: number;
}

/**
 * Coerce an `nvidia-smi` cell to a number. Non-numeric values such as
 * `[N/A]` or `[Not Supported]` (emitted for unsupported metrics) become 0,
 * matching the Python instrumentor's fallback.
 */
export function parseNumber(value: string): number {
  const n = Number(String(value).trim());
  return Number.isFinite(n) ? n : 0;
}

/**
 * Parse the CSV output of
 * `nvidia-smi --query-gpu=... --format=csv,noheader,nounits`
 * into one {@link GpuStatsRow} per GPU. Pure — safe to unit test.
 */
export function parseNvidiaSmiCsv(raw: string): GpuStatsRow[] {
  const rows: GpuStatsRow[] = [];

  for (const line of String(raw).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const cols = trimmed.split(',').map((c) => c.trim());
    if (cols.length < NVIDIA_SMI_FIELDS.length) continue;

    // The last NUMERIC_COLS columns are always numeric; index/uuid never
    // contain commas. Any extra columns in between belong to a GPU name that
    // itself contained a comma, so stitch them back together.
    const numeric = cols.slice(cols.length - NUMERIC_COLS);
    const name = cols.slice(2, cols.length - NUMERIC_COLS).join(', ');

    rows.push({
      index: cols[0],
      uuid: cols[1],
      name,
      utilization: parseNumber(numeric[0]),
      utilizationEnc: parseNumber(numeric[1]),
      utilizationDec: parseNumber(numeric[2]),
      temperature: parseNumber(numeric[3]),
      fanSpeed: parseNumber(numeric[4]),
      memoryFree: parseNumber(numeric[5]),
      memoryTotal: parseNumber(numeric[6]),
      memoryUsed: parseNumber(numeric[7]),
      powerDraw: parseNumber(numeric[8]),
      powerLimit: parseNumber(numeric[9]),
    });
  }

  return rows;
}

/** Injectable form of `child_process.execFile` for testing. */
export type ExecFileLike = (
  file: string,
  args: string[],
  options: { timeout?: number },
  callback: (error: Error | null, stdout: string, stderr: string) => void
) => void;

const defaultExecFile: ExecFileLike = (file, args, options, callback) => {
  execFile(file, args, options, (error, stdout, stderr) =>
    callback(error, String(stdout), String(stderr))
  );
};

/**
 * Returns true when `nvidia-smi` is present and lists at least one GPU.
 * Never throws — resolves false on any error (missing binary, non-GPU host).
 */
export function isNvidiaSmiAvailable(execFileFn: ExecFileLike = defaultExecFile): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      execFileFn('nvidia-smi', ['-L'], { timeout: 5000 }, (error, stdout) => {
        resolve(!error && String(stdout).trim().length > 0);
      });
    } catch {
      resolve(false);
    }
  });
}

/**
 * Query `nvidia-smi` once and return parsed per-GPU stats. Never throws —
 * resolves to an empty array on any failure so a transient error during a
 * metric-export tick simply reports no observations for that tick.
 */
export function queryNvidiaSmi(execFileFn: ExecFileLike = defaultExecFile): Promise<GpuStatsRow[]> {
  return new Promise((resolve) => {
    try {
      execFileFn(
        'nvidia-smi',
        [`--query-gpu=${NVIDIA_SMI_FIELDS.join(',')}`, '--format=csv,noheader,nounits'],
        { timeout: 5000 },
        (error, stdout) => {
          if (error) {
            resolve([]);
            return;
          }
          resolve(parseNvidiaSmiCsv(String(stdout)));
        }
      );
    } catch {
      resolve([]);
    }
  });
}
