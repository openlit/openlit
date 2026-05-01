jest.mock("@/lib/platform/vault/table-details", () => ({
	OPENLIT_VAULT_TABLE_NAME: "openlit_vault",
}));

jest.mock("@/lib/platform/common", () => ({
	dataCollector: jest.fn(),
}));

jest.mock("@/utils/crypto", () => ({
	encryptValue: jest.fn((value: string) => `enc:v1:${value}`),
	isEncrypted: jest.fn((value: string) => value.startsWith("enc:v1:")),
}));

jest.mock("@/lib/db-config", () => ({
	getDBConfigById: jest.fn(),
	getDBConfigByUser: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
	__esModule: true,
	default: {
		clickhouseMigrations: {
			findFirst: jest.fn(),
			create: jest.fn(),
		},
	},
}));

jest.mock("@/utils/log", () => ({
	consoleLog: jest.fn(),
}));

import EncryptVaultValuesMigration from "@/clickhouse/migrations/encrypt-vault-values-migration";
import { dataCollector } from "@/lib/platform/common";
import { getDBConfigByUser } from "@/lib/db-config";
import prisma from "@/lib/prisma";

describe("EncryptVaultValuesMigration", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		(getDBConfigByUser as jest.Mock).mockResolvedValue({ id: "db-1" });
		(prisma.clickhouseMigrations.findFirst as jest.Mock).mockResolvedValue(null);
		(prisma.clickhouseMigrations.create as jest.Mock).mockResolvedValue({ id: "migration-1" });
		(dataCollector as jest.Mock)
			.mockResolvedValueOnce({
				data: [{ id: "secret\\1", value: "plain\\value'secret" }],
				err: null,
			})
			.mockResolvedValueOnce({ err: null });
	});

	it("escapes backslashes before quotes in generated update queries", async () => {
		await EncryptVaultValuesMigration();

		expect(dataCollector).toHaveBeenCalledTimes(2);
		const [{ query }, mode, databaseConfigId] = (dataCollector as jest.Mock).mock.calls[1];

		expect(mode).toBe("exec");
		expect(databaseConfigId).toBe("db-1");
		expect(query).toContain("UPDATE value = 'enc:v1:plain\\\\value\\'secret'");
		expect(query).toContain("WHERE id = 'secret\\\\1'");
	});
});
