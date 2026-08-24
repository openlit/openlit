import {
	clampDateRangeToLimit,
	effectiveRangeLimit,
	isPresetRangeSupported,
} from "@/components/(playground)/filter";

describe("connector-driven telemetry time ranges", () => {
	it("uses the tighter of a connector's query and retention limits", () => {
		expect(effectiveRangeLimit({
			capabilities: { maxTimeRangeMs: 7_200_000, maxLookbackMs: 3_600_000 },
		})).toBe(3_600_000);
		expect(effectiveRangeLimit({ capabilities: {} })).toBeUndefined();
	});

	it("keeps all presets available when the datasource advertises no limit", () => {
		expect(isPresetRangeSupported("3M")).toBe(true);
		expect(isPresetRangeSupported("CUSTOM")).toBe(true);
	});

	it("disables only presets wider than the selected datasource supports", () => {
		const sevenDays = 7 * 24 * 60 * 60 * 1000;
		expect(isPresetRangeSupported("24H", sevenDays)).toBe(true);
		expect(isPresetRangeSupported("7D", sevenDays)).toBe(true);
		expect(isPresetRangeSupported("1M", sevenDays)).toBe(false);
	});

	it("clamps a custom selection at the datasource boundary", () => {
		const end = new Date("2026-08-06T00:00:00.000Z");
		const start = new Date("2026-07-01T00:00:00.000Z");
		const max = 7 * 24 * 60 * 60 * 1000;
		expect(clampDateRangeToLimit(start, end, max)).toEqual({
			start: new Date("2026-07-30T00:00:00.000Z"),
			end,
			clamped: true,
		});
	});
});
