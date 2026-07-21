jest.mock("@/lib/prisma", () => ({
	__esModule: true,
	default: {
		clickhouseMigrations: {
			findFirst: jest.fn(),
			create: jest.fn(),
		},
	},
}));

import prisma from "@/lib/prisma";
import { getInstallId } from "@/lib/platform/telemetry-snapshot/install-id";

const findFirst = prisma.clickhouseMigrations.findFirst as jest.Mock;
const create = prisma.clickhouseMigrations.create as jest.Mock;

describe("getInstallId", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("returns the existing install id when present", async () => {
		findFirst.mockResolvedValue({
			clickhouseMigrationId: "existing-id",
			databaseConfigId: "telemetry:install-id",
		});

		await expect(getInstallId()).resolves.toBe("existing-id");
		expect(create).not.toHaveBeenCalled();
	});

	it("creates and returns a new id when none exists", async () => {
		findFirst.mockResolvedValue(null);
		create.mockResolvedValue({});

		const id = await getInstallId();
		expect(typeof id).toBe("string");
		expect(id.length).toBeGreaterThan(0);
		expect(create).toHaveBeenCalledWith({
			data: {
				databaseConfigId: "telemetry:install-id",
				clickhouseMigrationId: id,
			},
		});
	});

	it("re-reads after a create race and returns the winner", async () => {
		findFirst
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({
				clickhouseMigrationId: "winner-id",
				databaseConfigId: "telemetry:install-id",
			});
		create.mockRejectedValue(new Error("unique constraint"));

		await expect(getInstallId()).resolves.toBe("winner-id");
	});

	it("returns the locally generated id when create fails and re-read is empty", async () => {
		findFirst.mockResolvedValue(null);
		create.mockRejectedValue(new Error("db down"));

		const id = await getInstallId();
		expect(typeof id).toBe("string");
		expect(id.length).toBeGreaterThan(0);
	});
});
