import { decryptValue, encryptValue, isEncrypted } from "@/utils/crypto";

const ORIGINAL_ENV = process.env;

describe("vault crypto utilities", () => {
	beforeEach(() => {
		process.env = { ...ORIGINAL_ENV };
		process.env.OPENLIT_VAULT_ENCRYPTION_KEY = "test-vault-key";
		delete process.env.NEXTAUTH_SECRET;
		jest.restoreAllMocks();
	});

	afterAll(() => {
		process.env = ORIGINAL_ENV;
	});

	it("encrypts plaintext values with the encrypted prefix", () => {
		const encrypted = encryptValue("secret-value");

		expect(encrypted).toMatch(/^enc:v1:/);
		expect(encrypted).not.toContain("secret-value");
		expect(isEncrypted(encrypted)).toBe(true);
	});

	it("decrypts values encrypted with the same key", () => {
		const encrypted = encryptValue("secret-value");

		expect(decryptValue(encrypted)).toBe("secret-value");
	});

	it("returns empty and already encrypted values unchanged", () => {
		expect(encryptValue("")).toBe("");
		expect(decryptValue("")).toBe("");
		expect(encryptValue("enc:v1:already")).toBe("enc:v1:already");
	});

	it("falls back to NEXTAUTH_SECRET when no dedicated vault key is set", () => {
		delete process.env.OPENLIT_VAULT_ENCRYPTION_KEY;
		process.env.NEXTAUTH_SECRET = "nextauth-secret";

		const encrypted = encryptValue("fallback-secret");

		expect(decryptValue(encrypted)).toBe("fallback-secret");
	});

	it("throws when no encryption key is configured", () => {
		delete process.env.OPENLIT_VAULT_ENCRYPTION_KEY;
		delete process.env.NEXTAUTH_SECRET;

		expect(() => encryptValue("weakly-keyed-secret")).toThrow(
			"No encryption key configured. Set OPENLIT_VAULT_ENCRYPTION_KEY or NEXTAUTH_SECRET."
		);
	});

	it("returns raw values that are not encrypted", () => {
		expect(decryptValue("plain-value")).toBe("plain-value");
		expect(isEncrypted("plain-value")).toBe(false);
		expect(isEncrypted("")).toBe(false);
	});

	it("returns malformed encrypted values unchanged", () => {
		const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

		expect(decryptValue("enc:v1:malformed")).toBe("enc:v1:malformed");
		expect(errorSpy).toHaveBeenCalledWith("Invalid encrypted value format");
	});

	it("returns tampered encrypted values unchanged when decryption fails", () => {
		const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
		const encrypted = encryptValue("secret-value");
		const tampered = encrypted.replace(/.$/, "x");

		expect(decryptValue(tampered)).toBe(tampered);
		expect(errorSpy).toHaveBeenCalledWith(
			"Decryption failed, returning raw value:",
			expect.anything()
		);
	});
});
