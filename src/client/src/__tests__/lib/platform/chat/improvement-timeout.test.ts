import {
	DEFAULT_TRACE_IMPROVEMENT_TIMEOUT_MS,
	MAX_TRACE_IMPROVEMENT_TIMEOUT_MS,
	traceImprovementTimeoutMs,
} from '@/lib/platform/chat/improvement-timeout';

describe('traceImprovementTimeoutMs', () => {
	const inherited = process.env.OPENLIT_TRACE_IMPROVEMENT_TIMEOUT_MS;

	beforeEach(() => {
		delete process.env.OPENLIT_TRACE_IMPROVEMENT_TIMEOUT_MS;
	});

	afterAll(() => {
		if (inherited !== undefined) process.env.OPENLIT_TRACE_IMPROVEMENT_TIMEOUT_MS = inherited;
	});

	afterEach(() => {
		delete process.env.OPENLIT_TRACE_IMPROVEMENT_TIMEOUT_MS;
	});

	it('keeps the two minute default when unset', () => {
		expect(traceImprovementTimeoutMs()).toBe(DEFAULT_TRACE_IMPROVEMENT_TIMEOUT_MS);
		expect(DEFAULT_TRACE_IMPROVEMENT_TIMEOUT_MS).toBe(120_000);
	});

	it('uses OPENLIT_TRACE_IMPROVEMENT_TIMEOUT_MS when it is a positive number', () => {
		process.env.OPENLIT_TRACE_IMPROVEMENT_TIMEOUT_MS = '1800000';
		expect(traceImprovementTimeoutMs()).toBe(1_800_000);
	});

	it('caps a value past the browser timer limit so the run is not aborted at once', () => {
		process.env.OPENLIT_TRACE_IMPROVEMENT_TIMEOUT_MS = '9999999999';
		expect(traceImprovementTimeoutMs()).toBe(MAX_TRACE_IMPROVEMENT_TIMEOUT_MS);
	});

	it.each(['', '0', '-5', 'abc'])('falls back to the default for %p', (value) => {
		process.env.OPENLIT_TRACE_IMPROVEMENT_TIMEOUT_MS = value;
		expect(traceImprovementTimeoutMs()).toBe(DEFAULT_TRACE_IMPROVEMENT_TIMEOUT_MS);
	});
});
