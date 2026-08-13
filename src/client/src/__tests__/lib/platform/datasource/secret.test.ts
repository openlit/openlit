import {
	__resetSourceSecretCacheForTests,
	resolveSourceSecret,
} from "@/lib/platform/connectors/datasource/http/secret";

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
});
