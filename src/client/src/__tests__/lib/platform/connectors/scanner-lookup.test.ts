jest.mock("@/lib/platform/connectors/scanner/crud", () => ({
	listScannerConnectors: jest.fn(),
}));

import {
	matchScannerFindingsForRepo,
	scannerWorkspaceUrl,
} from "@/lib/platform/connectors/scanner/lookup";
import type { ScannerJob } from "@/lib/platform/connectors/scanner/types";

function finding(id: string, severity: string, title: string) {
	return { id, ruleId: id, severity, title };
}

function job(overrides: Partial<ScannerJob>): ScannerJob {
	return {
		id: "job:1",
		status: "succeeded",
		target: "https://github.com/acme/checkout-agent",
		startedAt: "2026-09-07T10:00:00.000Z",
		finishedAt: "2026-09-07T10:01:00.000Z",
		findings: [finding("CSDK-010", "high", "Unsafe SDK usage")],
		findingCount: 1,
		mediumPlusCount: 1,
		...overrides,
	};
}

describe("scanner findings lookup", () => {
	it("builds scanner workspace deep links", () => {
		expect(scannerWorkspaceUrl()).toBe("/scanner");
		expect(scannerWorkspaceUrl("scanner:abc", "job:1")).toBe(
			"/scanner?connectorId=scanner%3Aabc&jobId=job%3A1"
		);
	});

	it("joins coding-agent repo URLs to the latest succeeded job", () => {
		const result = matchScannerFindingsForRepo(
			[
				{
					id: "scanner:old",
					name: "Older scan",
					jobs: [
						job({
							id: "job:old",
							finishedAt: "2026-09-01T10:00:00.000Z",
							findings: [finding("OLD-1", "low", "Stale")],
							findingCount: 1,
							mediumPlusCount: 0,
						}),
					],
				},
				{
					id: "scanner:new",
					name: "Prod Trustabl",
					jobs: [
						job({
							id: "job:failed",
							status: "failed",
							finishedAt: "2026-09-08T12:00:00.000Z",
						}),
						job({
							id: "job:latest",
							target: "https://github.com/acme/checkout-agent.git",
							finishedAt: "2026-09-07T12:00:00.000Z",
							findings: [
								finding("LOW-1", "low", "Nit"),
								finding("CSDK-010", "high", "Unsafe SDK usage"),
								finding("MCP-2", "medium", "MCP allowlist"),
							],
							findingCount: 3,
							mediumPlusCount: 2,
						}),
					],
				},
			],
			"git@github.com:acme/checkout-agent.git"
		);

		expect(result).toMatchObject({
			matched: true,
			repoKey: "github.com/acme/checkout-agent",
			connectorId: "scanner:new",
			connectorName: "Prod Trustabl",
			jobId: "job:latest",
			mediumPlusCount: 2,
			findingCount: 3,
			url: "/scanner?connectorId=scanner%3Anew&jobId=job%3Alatest",
		});
		if (!result.matched) throw new Error("expected match");
		expect(result.findings.map((item) => item.id)).toEqual([
			"CSDK-010",
			"MCP-2",
			"LOW-1",
		]);
	});

	it("returns a miss when no succeeded job matches the repo", () => {
		expect(
			matchScannerFindingsForRepo(
				[
					{
						id: "scanner:other",
						name: "Other",
						jobs: [job({ target: "https://github.com/acme/other" })],
					},
				],
				"https://github.com/acme/checkout-agent"
			)
		).toEqual({
			matched: false,
			repoKey: "github.com/acme/checkout-agent",
			url: "/scanner",
		});
	});

	it("returns a miss for non-GitHub repo URLs", () => {
		expect(matchScannerFindingsForRepo([], "https://gitlab.com/acme/repo")).toEqual({
			matched: false,
			repoKey: null,
			url: "/scanner",
		});
	});
});
