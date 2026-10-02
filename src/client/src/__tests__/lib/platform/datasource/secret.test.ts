import {
	__resetSourceSecretCacheForTests,
	canSkipVaultForHttpNoneAuth,
	httpAuthNeedsVault,
	invalidateSourceSecretCache,
	redactableSecretValues,
	resolveSourceSecret,
} from "@/lib/platform/connectors/datasource/http/secret";
import { encryptValue } from "@/utils/crypto";
import {
	DATA_SOURCE_SECRET_NOT_FOUND,
} from "@/constants/messages/en";

jest.mock("@/lib/platform/vault", () => ({
	getSecretById: jest.fn(),
}));

import { getSecretById } from "@/lib/platform/vault";

describe("resolveSourceSecret", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		__resetSourceSecretCacheForTests();
	});

	it("parses JSON credentials from a decrypted vault value", async () => {
		(getSecretById as jest.Mock).mockResolvedValue({
			data: [
				{
					value: JSON.stringify({
						username: "1628208",
						password: "glc_token",
					}),
				},
			],
		});
		const secret = await resolveSourceSecret("sec-1");
		expect(secret.credentials).toEqual({
			username: "1628208",
			password: "glc_token",
		});
	});

	it("fails closed when decryption leaves ciphertext in place", async () => {
		(getSecretById as jest.Mock).mockResolvedValue({
			data: [{ value: "enc:v1:iv:tag:ciphertext" }],
		});
		await expect(resolveSourceSecret("sec-1")).rejects.toThrow(
			/could not be decrypted/i
		);
	});

	it("returns empty credentials when no secretRef is set", async () => {
		const secret = await resolveSourceSecret(null);
		expect(secret).toEqual({ raw: "", credentials: {} });
		expect(getSecretById).not.toHaveBeenCalled();
	});

	it("does not query ClickHouse vault when clickHouseVault is disabled", async () => {
		await expect(
			resolveSourceSecret("vault-uuid", undefined, "project-1", {
				clickHouseVault: false,
			})
		).rejects.toThrow(/could not be loaded from the OpenLIT vault/i);
		expect(getSecretById).not.toHaveBeenCalled();
	});

	it("forwards the background database and project scope to the vault lookup", async () => {
		(getSecretById as jest.Mock).mockResolvedValue({
			data: [{ value: '{"token":"abc"}' }],
		});

		await resolveSourceSecret("sec-1", "db-1", "project-1");

		expect(getSecretById).toHaveBeenCalledWith("sec-1", "db-1", false, {
			logDecryptErrors: false,
			projectId: "project-1",
		});
	});

	it("fails locally when the credential vault query fails", async () => {
		(getSecretById as jest.Mock).mockResolvedValue({
			err: new Error("read ECONNRESET"),
		});

		await expect(resolveSourceSecret("sec-1", "db-1", "project-1"))
			.rejects.toThrow(/could not be loaded from the OpenLIT vault/i);
	});

	it("reports the secret as not found when the vault returns no rows", async () => {
		(getSecretById as jest.Mock).mockResolvedValue({ data: [] });
		await expect(resolveSourceSecret("sec-empty")).rejects.toThrow(
			/missing from the OpenLIT vault/i
		);
	});

	it("reports the secret as not found when the row's value is an empty string", async () => {
		(getSecretById as jest.Mock).mockResolvedValue({
			data: [{ value: "" }],
		});
		await expect(resolveSourceSecret("sec-empty-value")).rejects.toThrow(
			/missing from the OpenLIT vault/i
		);
	});

	it("reports the secret as not found when the row's value is not a string", async () => {
		(getSecretById as jest.Mock).mockResolvedValue({
			data: [{ value: 12345 as unknown as string }],
		});
		await expect(resolveSourceSecret("sec-non-string-value")).rejects.toThrow(
			/missing from the OpenLIT vault/i
		);
	});

	it("treats a non-JSON vault value as a bearer token", async () => {
		(getSecretById as jest.Mock).mockResolvedValue({
			data: [{ value: "opaque-token" }],
		});

		const secret = await resolveSourceSecret("sec-opaque");
		expect(secret.credentials).toEqual({ token: "opaque-token" });
	});

	it("serves a short stale secret window when vault reads fail after a hit", async () => {
		const now = Date.now();
		const dateNow = jest.spyOn(Date, "now").mockReturnValue(now);
		(getSecretById as jest.Mock).mockResolvedValueOnce({
			data: [{ value: JSON.stringify({ token: "fresh" }) }],
		});
		const first = await resolveSourceSecret("sec-stale");
		expect(first.credentials).toEqual({ token: "fresh" });

		// Past fresh TTL (2m), still inside stale window (5m).
		dateNow.mockReturnValue(now + 3 * 60_000);
		(getSecretById as jest.Mock).mockResolvedValueOnce({
			err: new Error("vault blip"),
		});
		const second = await resolveSourceSecret("sec-stale");
		expect(second.credentials).toEqual({ token: "fresh" });
		expect(getSecretById).toHaveBeenCalledTimes(2);
		dateNow.mockRestore();
	});

	it("re-queries the vault after invalidating a specific secretRef's cache entry", async () => {
		(getSecretById as jest.Mock).mockResolvedValue({
			data: [{ value: '{"token":"first"}' }],
		});
		const first = await resolveSourceSecret("sec-invalidate");
		expect(first.credentials).toEqual({ token: "first" });
		expect(getSecretById).toHaveBeenCalledTimes(1);

		// Cache hit: no additional vault query.
		await resolveSourceSecret("sec-invalidate");
		expect(getSecretById).toHaveBeenCalledTimes(1);

		invalidateSourceSecretCache("sec-invalidate");

		(getSecretById as jest.Mock).mockResolvedValue({
			data: [{ value: '{"token":"second"}' }],
		});
		const second = await resolveSourceSecret("sec-invalidate");
		expect(second.credentials).toEqual({ token: "second" });
		expect(getSecretById).toHaveBeenCalledTimes(2);
	});

	it("leaves unrelated cache entries untouched when invalidating one secretRef", async () => {
		(getSecretById as jest.Mock).mockResolvedValue({
			data: [{ value: '{"token":"keep-me"}' }],
		});
		await resolveSourceSecret("sec-keep");
		invalidateSourceSecretCache("sec-unrelated");

		// Still cached: no additional vault query for the untouched ref.
		await resolveSourceSecret("sec-keep");
		expect(getSecretById).toHaveBeenCalledTimes(1);
	});

	it("fails closed when an inline encrypted secretRef cannot be decrypted", async () => {
		await expect(
			resolveSourceSecret("enc:v1:iv:tag:ciphertext")
		).rejects.toThrow(/could not be decrypted/i);
		expect(getSecretById).not.toHaveBeenCalled();
	});

	it("decrypts an inline encrypted secretRef without querying the vault", async () => {
		const previous = process.env.NEXTAUTH_SECRET;
		process.env.NEXTAUTH_SECRET = "test-only-encryption-secret";
		try {
			const encryptedRef = encryptValue(
				JSON.stringify({ token: "direct-vault-value" })
			);
			const secret = await resolveSourceSecret(encryptedRef);
			expect(secret.credentials).toEqual({ token: "direct-vault-value" });
			expect(getSecretById).not.toHaveBeenCalled();
		} finally {
			if (previous === undefined) delete process.env.NEXTAUTH_SECRET;
			else process.env.NEXTAUTH_SECRET = previous;
		}
	});

	it("fails locally when the vault lookup throws and there is no usable stale cache", async () => {
		(getSecretById as jest.Mock).mockRejectedValueOnce(
			new Error("ECONNRESET")
		);
		await expect(resolveSourceSecret("sec-throws")).rejects.toThrow(
			/could not be loaded from the OpenLIT vault/i
		);
	});

	it("serves the stale cache when a rejected vault promise follows a prior hit", async () => {
		const now = Date.now();
		const dateNow = jest.spyOn(Date, "now").mockReturnValue(now);
		(getSecretById as jest.Mock).mockResolvedValueOnce({
			data: [{ value: JSON.stringify({ token: "fresh-reject" }) }],
		});
		const first = await resolveSourceSecret("sec-stale-reject");
		expect(first.credentials).toEqual({ token: "fresh-reject" });

		dateNow.mockReturnValue(now + 3 * 60_000);
		(getSecretById as jest.Mock).mockRejectedValueOnce(
			new Error("vault outage")
		);
		const second = await resolveSourceSecret("sec-stale-reject");
		expect(second.credentials).toEqual({ token: "fresh-reject" });
		dateNow.mockRestore();
	});
});

describe("redactableSecretValues", () => {
	it("collects the raw secret and every credential value", () => {
		const values = redactableSecretValues({
			raw: '{"token":"abc"}',
			credentials: { token: "abc", extra: "def" },
		});
		expect(values.sort()).toEqual(['{"token":"abc"}', "abc", "def"].sort());
	});

	it("de-duplicates repeated values across raw and credentials", () => {
		const values = redactableSecretValues({
			raw: "shared-value",
			credentials: { a: "shared-value", b: "shared-value" },
		});
		expect(values).toEqual(["shared-value"]);
	});

	it("skips falsy raw and falsy credential values", () => {
		const values = redactableSecretValues({
			raw: "",
			credentials: { empty: "", present: "value" },
		});
		expect(values).toEqual(["value"]);
	});

	it("returns an empty array when there is nothing to redact", () => {
		expect(redactableSecretValues({ raw: "", credentials: {} })).toEqual([]);
	});
});

describe("httpAuthNeedsVault", () => {
	it("requires the vault only for basic and bearer auth", () => {
		expect(httpAuthNeedsVault("none")).toBe(false);
		expect(httpAuthNeedsVault(undefined)).toBe(false);
		expect(httpAuthNeedsVault("basic")).toBe(true);
		expect(httpAuthNeedsVault("bearer")).toBe(true);
	});
});

describe("canSkipVaultForHttpNoneAuth", () => {
	it("skips missing vault rows when HTTP auth is none", () => {
		expect(
			canSkipVaultForHttpNoneAuth(
				new Error(DATA_SOURCE_SECRET_NOT_FOUND),
				"none"
			)
		).toBe(true);
	});

	it("does not skip vault errors when HTTP auth is basic", () => {
		expect(
			canSkipVaultForHttpNoneAuth(
				new Error(DATA_SOURCE_SECRET_NOT_FOUND),
				"basic"
			)
		).toBe(false);
	});
});
