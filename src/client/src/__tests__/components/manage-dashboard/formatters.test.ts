import { formatCompactNumber } from "@/components/(playground)/manage-dashboard/board-creator/utils/formatters";

describe("formatCompactNumber", () => {
	it("adds compact suffixes to large stat values", () => {
		expect(formatCompactNumber(1_250)).toBe("1.25K");
		expect(formatCompactNumber(3_400_000)).toBe("3.4M");
	});

	it("rounds normal values without losing small decimal values", () => {
		expect(formatCompactNumber(12.3456)).toBe("12.35");
		expect(formatCompactNumber(0.0001234)).toBe("0.0001");
	});

	it("preserves non-numeric values", () => {
		expect(formatCompactNumber("healthy")).toBe("healthy");
	});
});
