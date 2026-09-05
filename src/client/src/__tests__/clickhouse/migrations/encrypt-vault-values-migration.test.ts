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
	getDBConfigByIdInternal: jest.fn(),
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

	it("leaves the migration pending when the vault table cannot be read", async () => {
		(dataCollector as jest.Mock).mockReset();
		(dataCollector as jest.Mock).mockResolvedValueOnce({
			data: undefined,
			err: "default: Authentication failed: password is incorrect",
		});

		const result = await EncryptVaultValuesMigration();

		expect(prisma.clickhouseMigrations.create).not.toHaveBeenCalled();
		expect(result).toEqual({ migrationExist: false, queriesRun: false });
	});

	it("leaves the migration pending when a secret fails to encrypt", async () => {
		(dataCollector as jest.Mock).mockReset();
		(dataCollector as jest.Mock)
			.mockResolvedValueOnce({
				data: [
					{ id: "secret-1", value: "plaintext-1" },
					{ id: "secret-2", value: "plaintext-2" },
				],
				err: null,
			})
			.mockResolvedValueOnce({ err: null })
			.mockResolvedValueOnce({ err: "TABLE_IS_READ_ONLY" });

		const result = await EncryptVaultValuesMigration();

		expect(prisma.clickhouseMigrations.create).not.toHaveBeenCalled();
		expect(result).toEqual({ migrationExist: false, queriesRun: false });
	});

	it("records the migration when the vault holds no rows to encrypt", async () => {
		(dataCollector as jest.Mock).mockReset();
		(dataCollector as jest.Mock).mockResolvedValueOnce({ data: [], err: null });

		const result = await EncryptVaultValuesMigration();

		expect(prisma.clickhouseMigrations.create).toHaveBeenCalledTimes(1);
		expect(result).toEqual({ migrationExist: false, queriesRun: true });
	});

	it("records the migration when the read returns no rows and no error", async () => {
		(dataCollector as jest.Mock).mockReset();
		(dataCollector as jest.Mock).mockResolvedValueOnce({
			data: undefined,
			err: null,
		});

		const result = await EncryptVaultValuesMigration();

		expect(prisma.clickhouseMigrations.create).toHaveBeenCalledTimes(1);
		expect(result).toEqual({ migrationExist: false, queriesRun: true });
	});
});
