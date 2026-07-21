jest.mock("@/lib/prisma", () => ({
	__esModule: true,
	default: {
		user: { count: jest.fn() },
		organisation: { count: jest.fn() },
		project: { count: jest.fn() },
		databaseConfig: {
			count: jest.fn(),
			findMany: jest.fn(),
		},
		evaluationConfigs: { count: jest.fn() },
		pricingConfigs: { count: jest.fn() },
	},
}));

jest.mock("@/lib/posthog", () => ({
	__esModule: true,
	default: {
		capture: jest.fn().mockResolvedValue(undefined),
	},
}));

jest.mock("@/lib/platform/common", () => ({
	dataCollector: jest.fn(),
	OTEL_TRACES_TABLE_NAME: "otel_traces",
}));

jest.mock("@/lib/platform/telemetry-snapshot/install-id", () => ({
	getInstallId: jest.fn().mockResolvedValue("install-abc"),
}));

jest.mock("fs", () => ({
	...jest.requireActual("fs"),
	readFileSync: jest.fn(),
}));

import prisma from "@/lib/prisma";
import PostHogServer from "@/lib/posthog";
import { dataCollector } from "@/lib/platform/common";
import { getInstallId } from "@/lib/platform/telemetry-snapshot/install-id";
import { captureInstanceSnapshot } from "@/lib/platform/telemetry-snapshot";
import { readFileSync } from "fs";
import { SERVER_EVENTS } from "@/constants/events";

describe("captureInstanceSnapshot", () => {
	const originalEnabled = process.env.TELEMETRY_ENABLED;
	const originalVersion = process.env.npm_package_version;

	beforeEach(() => {
		jest.clearAllMocks();
		delete process.env.TELEMETRY_ENABLED;
		delete process.env.npm_package_version;

		(prisma.user.count as jest.Mock).mockResolvedValue(2);
		(prisma.organisation.count as jest.Mock).mockResolvedValue(1);
		(prisma.project.count as jest.Mock).mockResolvedValue(3);
		(prisma.databaseConfig.count as jest.Mock).mockResolvedValue(1);
		(prisma.evaluationConfigs.count as jest.Mock).mockResolvedValue(0);
		(prisma.pricingConfigs.count as jest.Mock).mockResolvedValue(1);
		(prisma.databaseConfig.findMany as jest.Mock).mockResolvedValue([
			{ id: "db-1" },
		]);
		(dataCollector as jest.Mock).mockResolvedValue({ data: [{ c: 5 }] });
		(getInstallId as jest.Mock).mockResolvedValue("install-abc");
	});

	afterEach(() => {
		if (originalEnabled === undefined) {
			delete process.env.TELEMETRY_ENABLED;
		} else {
			process.env.TELEMETRY_ENABLED = originalEnabled;
		}
		if (originalVersion === undefined) {
			delete process.env.npm_package_version;
		} else {
			process.env.npm_package_version = originalVersion;
		}
	});

	it("returns early when telemetry is disabled", async () => {
		process.env.TELEMETRY_ENABLED = "false";
		await expect(captureInstanceSnapshot()).resolves.toEqual({
			success: false,
			reason: "telemetry_disabled",
		});
		expect(getInstallId).not.toHaveBeenCalled();
	});

	it("captures aggregate counts and sends PostHog event", async () => {
		process.env.npm_package_version = "9.9.9";

		const result = await captureInstanceSnapshot();

		expect(result.success).toBe(true);
		expect(result.properties).toMatchObject({
			install_id: "install-abc",
			openlit_version: "9.9.9",
			users_total: 2,
			organisations_total: 1,
			projects_total: 3,
			db_configs_total: 1,
			eval_auto_enabled: false,
			pricing_auto_enabled: true,
			spans_total: 5,
		});
		expect(PostHogServer.capture).toHaveBeenCalledWith({
			event: SERVER_EVENTS.INSTANCE_TELEMETRY_SNAPSHOT,
			distinctId: "install-abc",
			properties: expect.objectContaining({ install_id: "install-abc" }),
		});
	});

	it("reads version from package.json when npm_package_version is unset", async () => {
		(readFileSync as jest.Mock).mockReturnValue(
			JSON.stringify({ version: "1.2.3" })
		);

		const result = await captureInstanceSnapshot();

		expect(result.properties?.openlit_version).toBe("1.2.3");
	});

	it("falls back to unknown version when package.json cannot be read", async () => {
		(readFileSync as jest.Mock).mockImplementation(() => {
			throw new Error("missing");
		});

		const result = await captureInstanceSnapshot();

		expect(result.properties?.openlit_version).toBe("unknown");
	});

	it("treats ClickHouse query failures as zero counts", async () => {
		(dataCollector as jest.Mock).mockRejectedValue(new Error("ch down"));
		process.env.npm_package_version = "1.0.0";

		const result = await captureInstanceSnapshot();

		expect(result.success).toBe(true);
		expect(result.properties).toMatchObject({
			spans_total: 0,
			traces_total: 0,
			app_agents_total: 0,
		});
	});

	it("sums totals across multiple database configs", async () => {
		(prisma.databaseConfig.findMany as jest.Mock).mockResolvedValue([
			{ id: "db-1" },
			{ id: "db-2" },
		]);
		(dataCollector as jest.Mock).mockResolvedValue({ data: [{ c: 3 }] });
		process.env.npm_package_version = "1.0.0";

		const result = await captureInstanceSnapshot();

		expect(result.properties?.spans_total).toBe(6);
	});

	it("ignores non-numeric ClickHouse values", async () => {
		(dataCollector as jest.Mock).mockResolvedValue({
			data: [{ c: "not-a-number" }],
		});
		process.env.npm_package_version = "1.0.0";

		const result = await captureInstanceSnapshot();

		expect(result.properties?.spans_total).toBe(0);
	});

	it("handles empty ClickHouse rows", async () => {
		(dataCollector as jest.Mock).mockResolvedValue({ data: [] });
		process.env.npm_package_version = "1.0.0";

		const result = await captureInstanceSnapshot();

		expect(result.properties?.spans_total).toBe(0);
	});
});
