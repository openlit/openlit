import { isValidCronJobRequest } from "@/helpers/server/cron-auth";

describe("isValidCronJobRequest", () => {
	const original = process.env.CRON_JOB_SECRET;

	afterEach(() => {
		if (original === undefined) {
			delete process.env.CRON_JOB_SECRET;
		} else {
			process.env.CRON_JOB_SECRET = original;
		}
	});

	function requestWith(header: string, value: string) {
		return {
			headers: {
				get: (name: string) =>
					name.toLowerCase() === header.toLowerCase() ? value : null,
			},
		};
	}

	it("accepts the true sentinel when no secret is configured", () => {
		delete process.env.CRON_JOB_SECRET;
		expect(isValidCronJobRequest(requestWith("X-CRON-JOB", "true"))).toBe(true);
		expect(isValidCronJobRequest(requestWith("X-CRON-JOB", "other"))).toBe(
			false
		);
	});

	it("requires an exact match when a secret is configured", () => {
		process.env.CRON_JOB_SECRET = "per-install-secret";
		expect(
			isValidCronJobRequest(requestWith("X-CRON-JOB", "per-install-secret"))
		).toBe(true);
		expect(isValidCronJobRequest(requestWith("X-CRON-JOB", "true"))).toBe(false);
		expect(isValidCronJobRequest(requestWith("x-cron-job", "per-install-secret"))).toBe(
			true
		);
	});
});
