import type EdgeEvents from '../events.edge';
import type Events from '../events';
import type EdgeTracing from '../tracing.edge';
import type Tracing from '../tracing';
import type * as EdgePlatform from '../../platform/index.edge';
import type * as Platform from '../../platform';

/**
 * The edge build swaps these modules at bundle time, while every import is
 * type-checked against the Node file. Nothing else stops the two drifting apart,
 * so a missing member in an edge file must fail here, at compile time.
 */
type Members<T, Keys extends PropertyKey> = { [K in Extract<keyof T, Keys>]: unknown };
type Tracer = 'setup' | 'reconfigure' | 'forceFlush' | 'shutdown' | 'droppedSpans' | 'spanProcessors' | 'resource';
type Logger = 'setup' | 'forceFlush' | 'shutdown';

const assertTracing = (edge: Members<typeof EdgeTracing, Tracer>): Members<typeof Tracing, Tracer> => edge;
const assertEvents = (edge: Members<typeof EdgeEvents, Logger>): Members<typeof Events, Logger> => edge;
const assertPlatform = (edge: typeof EdgePlatform): Omit<typeof Platform, 'IS_EDGE_BUILD'> => edge;

describe('edge module parity', () => {
  it('is checked by the compiler', () => {
    expect([assertTracing, assertEvents, assertPlatform]).toHaveLength(3);
  });
});
