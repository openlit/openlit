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

	it("rejects missing or non-string emails", () => {
		expect(validateEmail("")).toEqual({
			valid: false,
			error: "Email is required",
		});
		expect(validateEmail(undefined as unknown as string)).toEqual({
			valid: false,
			error: "Email is required",
		});
	});

	it("rejects emails that are too long", () => {
		const longEmail = `${"a".repeat(260)}@example.com`;

		expect(validateEmail(longEmail)).toEqual({
			valid: false,
			error: "Email is too long",
		});
	});

	it("rejects emails without exactly one @ sign", () => {
		expect(validateEmail("userexample.com").valid).toBe(false);
		expect(validateEmail("user@sub@example.com").valid).toBe(false);
	});

	it("rejects local parts with disallowed characters", () => {
		expect(validateEmail("user,name@example.com").valid).toBe(false);
	});

	it("rejects domains with consecutive dots", () => {
		expect(validateEmail("user@example..com").valid).toBe(false);
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

	it("allows an explicitly configured local ClickHouse host", () => {
		expect(validateDatabaseHost("127.0.0.1", { allowPrivateNetwork: true }).valid).toBe(true);
		expect(validateDatabaseHost("localhost", { allowPrivateNetwork: true }).valid).toBe(true);
		expect(validateDatabaseHost("169.254.169.254", { allowPrivateNetwork: true }).valid).toBe(false);
	});

	it("rejects private IPv6 and invalid host characters", () => {
		expect(validateDatabaseHost("[::1]").valid).toBe(false);
		expect(validateDatabaseHost("[fe80::1]").valid).toBe(false);
		expect(validateDatabaseHost("[fc00::1]").valid).toBe(false);
		expect(validateDatabaseHost("host$name").valid).toBe(false);
	});

	it("rejects unique-local IPv6 addresses identified only by the fd prefix", () => {
		expect(validateDatabaseHost("[fd00::1]")).toEqual({
			valid: false,
			error: "Private, loopback, and link-local IP addresses are not allowed",
		});
	});

	it("allows an explicitly configured private IPv6 host, but not link-local", () => {
		expect(validateDatabaseHost("[fc00::1]", { allowPrivateNetwork: true }).valid).toBe(true);
		expect(validateDatabaseHost("[fd00::1]", { allowPrivateNetwork: true }).valid).toBe(true);
		expect(validateDatabaseHost("[fe80::1]", { allowPrivateNetwork: true }).valid).toBe(false);
	});

	it("rejects the unspecified IPv4 address", () => {
		expect(validateDatabaseHost("0.0.0.0")).toEqual({
			valid: false,
			error: "Private, loopback, and link-local IP addresses are not allowed",
		});
	});

	it("does not apply IPv4-only private-range checks to public, unbracketed IPv6 addresses", () => {
		expect(validateDatabaseHost("2001:4860:4860::88ff").valid).toBe(true);
	});

	it("rejects a missing or non-string host", () => {
		expect(validateDatabaseHost("")).toEqual({
			valid: false,
			error: "Host is required",
		});
		expect(validateDatabaseHost(null as unknown as string)).toEqual({
			valid: false,
			error: "Host is required",
		});
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

	it("returns the fallback when an Error has an empty message", () => {
		expect(sanitizeErrorMessage(new Error(""))).toBe("An unexpected error occurred");
	});

	it("keeps safe user-facing messages", () => {
		expect(sanitizeErrorMessage("Invalid input")).toBe("Invalid input");
		expect(
			sanitizeErrorMessage(
				'Error: A connector named "prod-loki" already exists in the production environment. Choose a different name.'
			)
		).toBe(
			'A connector named "prod-loki" already exists in the production environment. Choose a different name.'
		);
	});
});
