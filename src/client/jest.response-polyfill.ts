/**
 * jsdom does not expose a Fetch API Response with static `.json()` the way
 * Next route helpers expect. Always install a minimal polyfill for unit tests.
 */
export function ensureResponsePolyfill() {
	class TestResponse {
		status: number;
		private body: unknown;

		constructor(body: unknown, init?: { status?: number }) {
			this.body = body;
			this.status = init?.status || 200;
		}

		static json(body: unknown, init?: { status?: number }) {
			return new TestResponse(body, init);
		}

		async json() {
			return this.body;
		}
	}

	(globalThis as any).Response = TestResponse;
}

ensureResponsePolyfill();
