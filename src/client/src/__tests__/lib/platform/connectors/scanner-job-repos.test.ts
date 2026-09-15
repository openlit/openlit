import {
	groupScannerJobsByRepo,
	scannerJobRepoKey,
	scannerRepoDisplayLabel,
} from "@/lib/platform/connectors/scanner/job-repos";
import type { ScannerJob } from "@/lib/platform/connectors/scanner/types";

function job(overrides: Partial<ScannerJob>): ScannerJob {
	return {
		id: "job:1",
		status: "succeeded",
		target: "https://github.com/acme/checkout-agent",
		startedAt: "2026-09-07T10:00:00.000Z",
		...overrides,
	};
}

describe("scanner job repo grouping", () => {
	it("labels a GitHub repo key as owner/repo", () => {
		expect(scannerRepoDisplayLabel("github.com/acme/checkout-agent")).toBe(
			"acme/checkout-agent"
		);
	});

	it("groups jobs that share a repo even when the URL includes a tree ref", () => {
		const groups = groupScannerJobsByRepo([
			job({ id: "job:new", startedAt: "2026-09-08T10:00:00.000Z" }),
			job({
				id: "job:tree",
				target: "https://github.com/acme/checkout-agent/tree/main",
			}),
			job({
				id: "job:other",
				target: "https://github.com/acme/payments",
			}),
		]);

		expect(groups.map((group) => group.label)).toEqual([
			"acme/checkout-agent",
			"acme/payments",
		]);
		expect(groups[0].jobs.map((item) => item.id)).toEqual(["job:new", "job:tree"]);
		expect(scannerJobRepoKey(groups[0].jobs[0])).toBe("github.com/acme/checkout-agent");
	});

	it("includes the connector default target even before a job exists", () => {
		const groups = groupScannerJobsByRepo(
			[],
			"https://github.com/acme/checkout-agent"
		);
		expect(groups).toEqual([
			{
				repoKey: "github.com/acme/checkout-agent",
				label: "acme/checkout-agent",
				target: "https://github.com/acme/checkout-agent",
				jobs: [],
			},
		]);
	});
});
