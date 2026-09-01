import { shouldCaptureServerTelemetryEvent } from "@/lib/posthog-sampling";

describe("posthog sampling", () => {
	const originalEnv = process.env.POSTHOG_DASHBOARD_QUERY_SAMPLE_RATE;

	afterEach(() => {
		if (originalEnv === undefined) {
			delete process.env.POSTHOG_DASHBOARD_QUERY_SAMPLE_RATE;
		} else {
			process.env.POSTHOG_DASHBOARD_QUERY_SAMPLE_RATE = originalEnv;
		}
		jest.restoreAllMocks();
	});

	it("always captures failures", () => {
		expect(
			shouldCaptureServerTelemetryEvent(
				"DASHBOARD_QUERY_RUN_FAILURE",
				"widget-1"
			)
		).toBe(true);
	});

	it("captures low-volume success events by default", () => {
		expect(
			shouldCaptureServerTelemetryEvent("CONNECTOR_CREATE_SUCCESS", "tempo")
		).toBe(true);
	});

	it("samples dashboard query successes at roughly 10%", () => {
		let captured = 0;
		for (let i = 0; i < 1_000; i += 1) {
			if (
				shouldCaptureServerTelemetryEvent(
					"DASHBOARD_QUERY_RUN_SUCCESS",
					`widget-${i}`
				)
			) {
				captured += 1;
			}
		}
		expect(captured).toBeGreaterThan(50);
		expect(captured).toBeLessThan(200);
	});

	it("respects the dashboard query sample-rate override", () => {
		process.env.POSTHOG_DASHBOARD_QUERY_SAMPLE_RATE = "0";
		expect(
			shouldCaptureServerTelemetryEvent(
				"DASHBOARD_QUERY_RUN_SUCCESS",
				"widget-1"
			)
		).toBe(false);
	});
});
