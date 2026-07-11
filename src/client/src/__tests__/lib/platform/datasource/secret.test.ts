import { resolveSourceSecret } from "@/lib/platform/datasource/http/secret";

jest.mock("@/lib/platform/vault", () => ({
	getSecretById: jest.fn(),
}));

import { getSecretById } from "@/lib/platform/vault";

describe("resolveSourceSecret", () => {
	beforeEach(() => {
		jest.clearAllMocks();
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

	it("returns empty credentials when decryption failed (ciphertext left in place)", async () => {
		(getSecretById as jest.Mock).mockResolvedValue({
			data: [{ value: "enc:v1:iv:tag:ciphertext" }],
		});
		const secret = await resolveSourceSecret("sec-1");
		expect(secret.credentials).toEqual({});
		expect(secret.raw).toBe("");
	});

	it("returns empty credentials when no secretRef is set", async () => {
		const secret = await resolveSourceSecret(null);
		expect(secret).toEqual({ raw: "", credentials: {} });
		expect(getSecretById).not.toHaveBeenCalled();
	});
});
