import net from "net";

export function validateDatabaseHost(host: string): {
	valid: boolean;
	error?: string;
} {
	if (!host || typeof host !== "string") {
		return { valid: false, error: "Host is required" };
	}

	const trimmed = host.trim();

	if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
		return { valid: false, error: "Host must not contain a URL scheme" };
	}

	if (/^\d+$/.test(trimmed) && !trimmed.includes(".")) {
		return { valid: false, error: "Numeric IP encoding is not allowed" };
	}

	if (/^0x[0-9a-fA-F]+$/i.test(trimmed)) {
		return { valid: false, error: "Hex-encoded IP addresses are not allowed" };
	}

	if (/^0\d+\./.test(trimmed)) {
		return {
			valid: false,
			error: "Octal-encoded IP addresses are not allowed",
		};
	}

	const hostPart = trimmed.replace(/:\d+$/, "");

	if (net.isIP(hostPart)) {
		if (!isAllowedIP(hostPart)) {
			return {
				valid: false,
				error: "Private, loopback, and link-local IP addresses are not allowed",
			};
		}

		return { valid: true };
	}

	if (/^\[.*\]/.test(hostPart)) {
		const ipv6 = hostPart.slice(1, hostPart.indexOf("]")).toLowerCase();
		if (
			ipv6 === "::1" ||
			ipv6.startsWith("fe80:") ||
			ipv6.startsWith("fc00:") ||
			ipv6.startsWith("fd")
		) {
			return {
				valid: false,
				error: "Private, loopback, and link-local IP addresses are not allowed",
			};
		}
	}

	const lowerHost = hostPart.toLowerCase();
	const blockedHosts = [
		"localhost",
		"metadata.google.internal",
		"169.254.169.254",
	];

	if (blockedHosts.includes(lowerHost)) {
		return { valid: false, error: `Host "${hostPart}" is not allowed` };
	}

	if (!/^[a-zA-Z0-9._\[\]:-]+$/.test(trimmed)) {
		return { valid: false, error: "Host contains invalid characters" };
	}

	return { valid: true };
}

function isAllowedIP(ip: string): boolean {
	const parts = ip.split(".").map(Number);
	if (parts.length !== 4) return true;

	if (parts[0] === 127) return false;
	if (parts[0] === 10) return false;
	if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return false;
	if (parts[0] === 192 && parts[1] === 168) return false;
	if (parts[0] === 169 && parts[1] === 254) return false;
	if (parts.every((part) => part === 0)) return false;

	return true;
}

export function validateProfileName(name: string): {
	valid: boolean;
	error?: string;
} {
	if (!name || typeof name !== "string") {
		return { valid: false, error: "Name is required" };
	}

	if (name.length > 100) {
		return { valid: false, error: "Name must be 100 characters or fewer" };
	}

	if (/<[^>]*>/.test(name)) {
		return { valid: false, error: "Name must not contain HTML tags" };
	}

	return { valid: true };
}

export function validateEmail(email: string): {
	valid: boolean;
	error?: string;
} {
	if (!email || typeof email !== "string") {
		return { valid: false, error: "Email is required" };
	}

	const trimmed = email.trim();

	if (trimmed.length > 254) {
		return { valid: false, error: "Email is too long" };
	}

	if (/[<>"'`&]/.test(trimmed)) {
		return { valid: false, error: "Email contains invalid characters" };
	}

	const parts = trimmed.split("@");
	if (parts.length !== 2) {
		return { valid: false, error: "Invalid email format" };
	}

	const [localPart, domain] = parts;

	if (
		localPart.length === 0 ||
		localPart.length > 64 ||
		localPart.startsWith(".") ||
		localPart.endsWith(".") ||
		localPart.includes("..")
	) {
		return { valid: false, error: "Invalid email format" };
	}

	if (!/^[A-Za-z0-9.!#$%*+/=?^_{|}~-]+$/.test(localPart)) {
		return { valid: false, error: "Invalid email format" };
	}

	if (domain.length === 0 || domain.length > 253 || domain.includes("..")) {
		return { valid: false, error: "Invalid email format" };
	}

	const labels = domain.split(".");
	if (labels.length < 2) {
		return { valid: false, error: "Invalid email format" };
	}

	const labelRegex = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
	if (!labels.every((label) => labelRegex.test(label))) {
		return { valid: false, error: "Invalid email format" };
	}

	const tld = labels[labels.length - 1];
	if (!/^[A-Za-z]{2,63}$/.test(tld)) {
		return { valid: false, error: "Invalid email format" };
	}

	return { valid: true };
}

export function validatePasswordComplexity(password: string): {
	valid: boolean;
	error?: string;
} {
	if (!password || typeof password !== "string") {
		return { valid: false, error: "Password is required" };
	}

	if (password.length < 8) {
		return { valid: false, error: "Password must be at least 8 characters long" };
	}

	if (password.length > 128) {
		return { valid: false, error: "Password must be 128 characters or fewer" };
	}

	if (!/[A-Z]/.test(password)) {
		return { valid: false, error: "Password must contain at least one uppercase letter" };
	}

	if (!/[a-z]/.test(password)) {
		return { valid: false, error: "Password must contain at least one lowercase letter" };
	}

	if (!/[0-9]/.test(password)) {
		return { valid: false, error: "Password must contain at least one number" };
	}

	return { valid: true };
}

export function sanitizeErrorMessage(
	err: unknown,
	fallback: string = "An unexpected error occurred"
): string {
	if (!err) return fallback;

	const message = typeof err === "string" ? err : (err as Error)?.message;
	if (!message) return fallback;

	if (
		message.includes("PrismaClient") ||
		message.includes("prisma.") ||
		message.includes("invocation:")
	) {
		return fallback;
	}

	if (
		message.includes("/etc/clickhouse") ||
		message.includes("clickhouse-server") ||
		message.includes("password is incorrect")
	) {
		return "Database connection error";
	}

	if (message.includes("    at ") || message.includes("TypeError:")) {
		return fallback;
	}

	if (
		message.includes("/Users/") ||
		message.includes("/home/") ||
		message.includes("/etc/")
	) {
		return fallback;
	}

	return message;
}
