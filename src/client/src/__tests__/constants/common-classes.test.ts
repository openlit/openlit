import { PRIMARY_BACKGROUND } from "@/constants/common-classes";

describe("PRIMARY_BACKGROUND", () => {
	it("is a non-empty string", () => {
		expect(typeof PRIMARY_BACKGROUND).toBe("string");
		expect(PRIMARY_BACKGROUND.length).toBeGreaterThan(0);
	});

	it("contains Tailwind CSS classes", () => {
		expect(PRIMARY_BACKGROUND).toContain("bg-");
	});

	it("contains dark mode classes", () => {
		expect(PRIMARY_BACKGROUND).toContain("dark:");
	});

	it("has the expected value", () => {
		expect(PRIMARY_BACKGROUND).toBe("bg-stone-100/50 dark:bg-stone-900/70");
	});
});
