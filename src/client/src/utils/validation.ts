import net from "net";

/**
 * Validates that a hostname is safe for use as a database connection host.
 * Blocks SSRF vectors: URL schemes, private IPs, loopback, link-local, metadata IPs.
 */
export function validateDatabaseHost(host: string): {
	valid: boolean;
	error?: string;
} {
	if (!host || typeof host !== "string") {
		return { valid: false, error: "Host is required" };
	}

	const trimmed = host.trim();

	// Block URL schemes (http://, https://, ftp://, gopher://, file://, etc.)
	if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
		return { valid: false, error: "Host must not contain a URL scheme" };
	}

	// Block pure numeric IPs (decimal encoding like 2130706433)
	if (/^\d+$/.test(trimmed) && !trimmed.includes(".")) {
		return { valid: false, error: "Numeric IP encoding is not allowed" };
	}

	// Block hex-encoded IPs (0x7f000001)
	if (/^0x[0-9a-fA-F]+$/i.test(trimmed)) {
		return { valid: false, error: "Hex-encoded IP addresses are not allowed" };
	}

	// Block octal-encoded IPs (0177.0.0.1)
	if (/^0\d+\./.test(trimmed)) {
		return {
			valid: false,
			error: "Octal-encoded IP addresses are not allowed",
		};
	}

	// Extract host part (strip port if present like host:port)
	const hostPart = trimmed.replace(/:\d+$/, "");

	// If it's an IP address, validate it
	if (net.isIP(hostPart)) {
		if (!isAllowedIP(hostPart)) {
			return {
				valid: false,
				error: "Private, loopback, and link-local IP addresses are not allowed",
			};
		}
		return { valid: true };
	}

	// Block IPv6 bracket notation
	if (/^\[.*\]/.test(hostPart)) {
		const ipv6 = hostPart.slice(1, hostPart.indexOf("]"));
		if (
			ipv6 === "::1" ||
			ipv6.startsWith("fe80:") ||
			ipv6.startsWith("fc00:") ||
			ipv6.startsWith("fd")
		) {
			return {
				valid: false,
				error:
					"Private, loopback, and link-local IP addresses are not allowed",
			};
		}
	}

	// Block known dangerous hostnames
	const lowerHost = hostPart.toLowerCase();
	const blockedHosts = [
		"localhost",
		"metadata.google.internal",
		"169.254.169.254",
	];
	if (blockedHosts.includes(lowerHost)) {
		return { valid: false, error: `Host "${hostPart}" is not allowed` };
	}

	// Validate hostname format (basic check)
	if (!/^[a-zA-Z0-9._\[\]:-]+$/.test(trimmed)) {
		return { valid: false, error: "Host contains invalid characters" };
	}

	return { valid: true };
}

function isAllowedIP(ip: string): boolean {
	const parts = ip.split(".").map(Number);
	if (parts.length !== 4) return true; // Not an IPv4, let other checks handle it

	// Loopback: 127.0.0.0/8
	if (parts[0] === 127) return false;

	// Private: 10.0.0.0/8
	if (parts[0] === 10) return false;

	// Private: 172.16.0.0/12
	if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return false;

	// Private: 192.168.0.0/16
	if (parts[0] === 192 && parts[1] === 168) return false;

	// Link-local: 169.254.0.0/16 (AWS metadata)
	if (parts[0] === 169 && parts[1] === 254) return false;

	// Unspecified: 0.0.0.0
	if (parts.every((p) => p === 0)) return false;

	return true;
}

/**
 * Validates that a user profile name is safe (no HTML/script injection).
 */
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

	// Reject HTML tags
	if (/<[^>]*>/.test(name)) {
		return { valid: false, error: "Name must not contain HTML tags" };
	}

	return { valid: true };
}

/**
 * Validates email format.
 */
export function validateEmail(email: string): {
	valid: boolean;
	error?: string;
} {
	if (!email || typeof email !== "string") {
		return { valid: false, error: "Email is required" };
	}

	// Basic email format validation
	const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
	if (!emailRegex.test(email)) {
		return { valid: false, error: "Invalid email format" };
	}

	if (email.length > 254) {
		return { valid: false, error: "Email is too long" };
	}

	return { valid: true };
}

/**
 * Validates password complexity.
 */
export function validatePasswordComplexity(password: string): {
	valid: boolean;
	error?: string;
} {
	if (!password || typeof password !== "string") {
		return { valid: false, error: "Password is required" };
	}

	if (password.length < 8) {
		return {
			valid: false,
			error: "Password must be at least 8 characters long",
		};
	}

	if (password.length > 128) {
		return {
			valid: false,
			error: "Password must be 128 characters or fewer",
		};
	}

	if (!/[A-Z]/.test(password)) {
		return {
			valid: false,
			error: "Password must contain at least one uppercase letter",
		};
	}

	if (!/[a-z]/.test(password)) {
		return {
			valid: false,
			error: "Password must contain at least one lowercase letter",
		};
	}

	if (!/[0-9]/.test(password)) {
		return {
			valid: false,
			error: "Password must contain at least one number",
		};
	}

	return { valid: true };
}

/**
 * Sanitizes an error message for client-facing responses.
 * Strips stack traces, internal paths, and technical details.
 */
export function sanitizeErrorMessage(
	err: unknown,
	fallback: string = "An unexpected error occurred"
): string {
	if (!err) return fallback;

	const message = typeof err === "string" ? err : (err as Error)?.message;
	if (!message) return fallback;

	// Block Prisma stack traces
	if (
		message.includes("PrismaClient") ||
		message.includes("prisma.") ||
		message.includes("invocation:")
	) {
		return fallback;
	}

	// Block ClickHouse internal details
	if (
		message.includes("/etc/clickhouse") ||
		message.includes("clickhouse-server") ||
		message.includes("password is incorrect")
	) {
		return "Database connection error";
	}

	// Block stack traces
	if (message.includes("    at ") || message.includes("TypeError:")) {
		return fallback;
	}

	// Block internal paths
	if (message.includes("/Users/") || message.includes("/home/") || message.includes("/etc/")) {
		return fallback;
	}

	return message;
}
