import {
	sanitizeErrorMessage,
	validateDatabaseHost,
	validateEmail,
	validatePasswordComplexity,
	validateProfileName,
} from "@/utils/validation";

describe("validateEmail", () => {
	it("accepts a normal RFC 5321 dot-atom email", () => {
		expect(validateEmail("user.name+tag@example.co").valid).toBe(true);
	});

	it("rejects HTML/script-bearing email strings", () => {
		const result = validateEmail('"><img src=x onerror=alert(1)>@test.com');

		expect(result).toEqual({
			valid: false,
			error: "Email contains invalid characters",
		});
	});

	it("rejects malformed local parts", () => {
		expect(validateEmail("@test.com").valid).toBe(false);
		expect(validateEmail(".user@example.com").valid).toBe(false);
		expect(validateEmail("user..name@example.com").valid).toBe(false);
		expect(validateEmail("user.@example.com").valid).toBe(false);
	});

	it("rejects malformed domains", () => {
		expect(validateEmail("user@example").valid).toBe(false);
		expect(validateEmail("user@-example.com").valid).toBe(false);
		expect(validateEmail("user@example-.com").valid).toBe(false);
		expect(validateEmail("user@example.c").valid).toBe(false);
	});
});

describe("validateDatabaseHost", () => {
	it("accepts public hostnames and public IPv4 addresses", () => {
		expect(validateDatabaseHost("clickhouse.example.com").valid).toBe(true);
		expect(validateDatabaseHost("8.8.8.8:8123").valid).toBe(true);
	});

	it("rejects schemes and encoded IP variants used for SSRF bypasses", () => {
		expect(validateDatabaseHost("http://clickhouse.example.com")).toEqual({
			valid: false,
			error: "Host must not contain a URL scheme",
		});
		expect(validateDatabaseHost("2130706433").valid).toBe(false);
		expect(validateDatabaseHost("0x7f000001").valid).toBe(false);
		expect(validateDatabaseHost("0177.0.0.1").valid).toBe(false);
	});

	it("rejects private, loopback, link-local, and metadata hosts", () => {
		expect(validateDatabaseHost("127.0.0.1").valid).toBe(false);
		expect(validateDatabaseHost("10.0.0.1").valid).toBe(false);
		expect(validateDatabaseHost("172.16.0.1").valid).toBe(false);
		expect(validateDatabaseHost("192.168.1.1").valid).toBe(false);
		expect(validateDatabaseHost("169.254.169.254").valid).toBe(false);
		expect(validateDatabaseHost("localhost").valid).toBe(false);
		expect(validateDatabaseHost("metadata.google.internal").valid).toBe(false);
	});

	it("rejects private IPv6 and invalid host characters", () => {
		expect(validateDatabaseHost("[::1]").valid).toBe(false);
		expect(validateDatabaseHost("[fe80::1]").valid).toBe(false);
		expect(validateDatabaseHost("[fc00::1]").valid).toBe(false);
		expect(validateDatabaseHost("host$name").valid).toBe(false);
	});
});

describe("validateProfileName", () => {
	it("accepts normal names", () => {
		expect(validateProfileName("Ada Lovelace")).toEqual({ valid: true });
	});

	it("rejects missing, long, and HTML-bearing names", () => {
		expect(validateProfileName("")).toEqual({
			valid: false,
			error: "Name is required",
		});
		expect(validateProfileName("a".repeat(101))).toEqual({
			valid: false,
			error: "Name must be 100 characters or fewer",
		});
		expect(validateProfileName("<script>alert(1)</script>")).toEqual({
			valid: false,
			error: "Name must not contain HTML tags",
		});
	});
});

describe("validatePasswordComplexity", () => {
	it("accepts complex passwords", () => {
		expect(validatePasswordComplexity("ValidPass1")).toEqual({ valid: true });
	});

	it("rejects missing, short, long, and incomplete passwords", () => {
		expect(validatePasswordComplexity("").valid).toBe(false);
		expect(validatePasswordComplexity("Short1").valid).toBe(false);
		expect(validatePasswordComplexity(`${"A".repeat(129)}a1`).valid).toBe(false);
		expect(validatePasswordComplexity("lowercase1").valid).toBe(false);
		expect(validatePasswordComplexity("UPPERCASE1").valid).toBe(false);
		expect(validatePasswordComplexity("NoNumbers").valid).toBe(false);
	});
});

describe("sanitizeErrorMessage", () => {
	it("returns the fallback for empty or internal framework errors", () => {
		expect(sanitizeErrorMessage(undefined, "Safe fallback")).toBe("Safe fallback");
		expect(sanitizeErrorMessage(new Error("PrismaClientKnownRequestError"))).toBe(
			"An unexpected error occurred"
		);
		expect(sanitizeErrorMessage("prisma.user.findMany invocation:")).toBe(
			"An unexpected error occurred"
		);
		expect(sanitizeErrorMessage("TypeError: Cannot read properties")).toBe(
			"An unexpected error occurred"
		);
		expect(sanitizeErrorMessage("Error\n    at /app/server.js:1")).toBe(
			"An unexpected error occurred"
		);
	});

	it("hides ClickHouse and local path details", () => {
		expect(sanitizeErrorMessage("/etc/clickhouse/config.xml failed")).toBe(
			"Database connection error"
		);
		expect(sanitizeErrorMessage("clickhouse-server password is incorrect")).toBe(
			"Database connection error"
		);
		expect(sanitizeErrorMessage("/Users/dev/project/file.ts")).toBe(
			"An unexpected error occurred"
		);
		expect(sanitizeErrorMessage("/home/app/file.ts")).toBe(
			"An unexpected error occurred"
		);
	});

	it("keeps safe user-facing messages", () => {
		expect(sanitizeErrorMessage("Invalid input")).toBe("Invalid input");
	});
});
