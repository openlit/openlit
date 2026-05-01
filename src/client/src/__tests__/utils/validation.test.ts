import { validateEmail } from "@/utils/validation";

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
