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

	const buf = createHash("sha256").update(secret).digest();
	return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

function toUint8Array(buf: Buffer): Uint8Array {
	return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

export function encryptValue(plaintext: string): string {
	if (!plaintext) return plaintext;
	if (plaintext.startsWith(ENCRYPTED_PREFIX)) return plaintext;

	const key = getEncryptionKey();
	const ivBuf = randomBytes(IV_LENGTH);
	const cipher = createCipheriv(ALGORITHM, key, toUint8Array(ivBuf));

	let encrypted = cipher.update(plaintext, "utf8", "base64");
	encrypted += cipher.final("base64");

	const authTag = cipher.getAuthTag();

	return `${ENCRYPTED_PREFIX}${ivBuf.toString("base64")}:${authTag.toString("base64")}:${encrypted}`;
}

export function decryptValue(encryptedValue: string): string {
	if (!encryptedValue) return encryptedValue;
	if (!encryptedValue.startsWith(ENCRYPTED_PREFIX)) return encryptedValue;

	try {
		const withoutPrefix = encryptedValue.slice(ENCRYPTED_PREFIX.length);
		const parts = withoutPrefix.split(":");

		if (parts.length !== 3) {
			console.error("Invalid encrypted value format");
			return encryptedValue;
		}

		const [ivBase64, authTagBase64, ciphertextBase64] = parts;
		const decipher = createDecipheriv(
			ALGORITHM,
			getEncryptionKey(),
			toUint8Array(Buffer.from(ivBase64, "base64"))
		);
		decipher.setAuthTag(toUint8Array(Buffer.from(authTagBase64, "base64")));

		let decrypted = decipher.update(ciphertextBase64, "base64", "utf8");
		decrypted += decipher.final("utf8");

		return decrypted;
	} catch (error) {
		console.error("Decryption failed, returning raw value:", error);
		return encryptedValue;
	}
}

export function isEncrypted(value: string): boolean {
	return !!value && value.startsWith(ENCRYPTED_PREFIX);
}
