import { getChartColors } from "@/constants/chart-colors";

describe("getChartColors", () => {
	it("returns an array", () => {
		expect(Array.isArray(getChartColors(3))).toBe(true);
	});

	it("returns the requested number of colors", () => {
		expect(getChartColors(1)).toHaveLength(1);
		expect(getChartColors(5)).toHaveLength(5);
		expect(getChartColors(11)).toHaveLength(11);
	});

	it("returns empty array for 0", () => {
		expect(getChartColors(0)).toHaveLength(0);
	});

	it("returns all non-empty strings", () => {
		getChartColors(5).forEach((color) => {
			expect(typeof color).toBe("string");
			expect(color.length).toBeGreaterThan(0);
		});
	});

	it("returns colors from the known palette", () => {
		const knownColors = new Set([
			"violet-600",
			"orange-500",
			"yellow-300",
			"lime-300",
			"green-600",
			"emerald-950",
			"sky-500",
			"fuchsia-700",
			"rose-800",
			"cyan-200",
			"pink-600",
		]);
		getChartColors(11).forEach((color) => {
			expect(knownColors.has(color)).toBe(true);
		});
	});

	it("returns unique colors when requesting less than palette size", () => {
		const colors = getChartColors(5);
		const uniqueColors = new Set(colors);
		expect(uniqueColors.size).toBe(5);
	});

	it("returns all palette colors when requesting the full palette size", () => {
		const colors = getChartColors(11);
		expect(colors).toHaveLength(11);
		const uniqueColors = new Set(colors);
		expect(uniqueColors.size).toBe(11);
	});

	it("can be called multiple times without error", () => {
		expect(() => {
			getChartColors(3);
			getChartColors(3);
		}).not.toThrow();
	});
});
