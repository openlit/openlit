import {
	createHash,
	randomBytes,
	createCipheriv,
	createDecipheriv,
	type CipherGCMTypes,
} from "crypto";

const ALGORITHM: CipherGCMTypes = "aes-256-gcm";
const IV_LENGTH = 16;
const ENCRYPTED_PREFIX = "enc:v1:";

/**
 * Derives a 32-byte encryption key from the provided secret.
 * Uses NEXTAUTH_SECRET as the encryption key source (always present in OpenLIT).
 */
function getEncryptionKey(): Uint8Array {
	const secret =
		process.env.OPENLIT_VAULT_ENCRYPTION_KEY ||
		process.env.NEXTAUTH_SECRET ||
		"";

	if (!secret) {
		console.warn(
			"WARNING: No encryption key configured. Set OPENLIT_VAULT_ENCRYPTION_KEY or NEXTAUTH_SECRET."
		);
	}

	// Derive a fixed 32-byte key from the secret using SHA-256
	const buf = createHash("sha256").update(secret).digest();
	return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

function toUint8Array(buf: Buffer): Uint8Array {
	return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Returns a prefixed string: "enc:v1:<iv>:<authTag>:<ciphertext>" (all base64).
 */
export function encryptValue(plaintext: string): string {
	if (!plaintext) return plaintext;

	// Don't double-encrypt
	if (plaintext.startsWith(ENCRYPTED_PREFIX)) return plaintext;

	const key = getEncryptionKey();
	const ivBuf = randomBytes(IV_LENGTH);
	const iv = toUint8Array(ivBuf);
	const cipher = createCipheriv(ALGORITHM, key, iv);

	let encrypted = cipher.update(plaintext, "utf8", "base64");
	encrypted += cipher.final("base64");

	const authTag = cipher.getAuthTag();

	return `${ENCRYPTED_PREFIX}${ivBuf.toString("base64")}:${authTag.toString("base64")}:${encrypted}`;
}

/**
 * Decrypts an encrypted string produced by encryptValue().
 * If the value is not encrypted (no prefix), returns it as-is (backward compatibility).
 */
export function decryptValue(encryptedValue: string): string {
	if (!encryptedValue) return encryptedValue;

	// Backward compatibility: if not encrypted, return as-is
	if (!encryptedValue.startsWith(ENCRYPTED_PREFIX)) return encryptedValue;

	try {
		const withoutPrefix = encryptedValue.slice(ENCRYPTED_PREFIX.length);
		const parts = withoutPrefix.split(":");

		if (parts.length !== 3) {
			console.error("Invalid encrypted value format");
			return encryptedValue;
		}

		const [ivBase64, authTagBase64, ciphertextBase64] = parts;
		const key = getEncryptionKey();
		const iv = toUint8Array(Buffer.from(ivBase64, "base64"));
		const authTag = toUint8Array(Buffer.from(authTagBase64, "base64"));

		const decipher = createDecipheriv(ALGORITHM, key, iv);
		decipher.setAuthTag(authTag);

		let decrypted = decipher.update(ciphertextBase64, "base64", "utf8");
		decrypted += decipher.final("utf8");

		return decrypted;
	} catch (error) {
		console.error("Decryption failed, returning raw value:", error);
		// If decryption fails (e.g., key changed), return the raw value
		// This prevents data loss but logs the error for investigation
		return encryptedValue;
	}
}

/**
 * Checks whether a value is already encrypted.
 */
export function isEncrypted(value: string): boolean {
	return !!value && value.startsWith(ENCRYPTED_PREFIX);
}
