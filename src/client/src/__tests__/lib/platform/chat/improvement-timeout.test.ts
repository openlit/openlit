import {
	DEFAULT_TRACE_IMPROVEMENT_TIMEOUT_MS,
	traceImprovementTimeoutMs,
} from '@/lib/platform/chat/improvement-timeout';

describe('traceImprovementTimeoutMs', () => {
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

	it.each(['', '0', '-5', 'abc'])('falls back to the default for %p', (value) => {
		process.env.OPENLIT_TRACE_IMPROVEMENT_TIMEOUT_MS = value;
		expect(traceImprovementTimeoutMs()).toBe(DEFAULT_TRACE_IMPROVEMENT_TIMEOUT_MS);
	});
});
