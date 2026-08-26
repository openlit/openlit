import {
	CURRENT_DASHBOARD_FORMAT_VERSION,
	DASHBOARD_FORMAT_VERSION_V1,
	DASHBOARD_FORMAT_VERSION_V2,
	detectDashboardFormatVersion,
	normalizeDashboardTags,
	normalizeImportedDashboard,
	toExportDashboardPayload,
} from "@/lib/platform/manage-dashboard/board-format";

describe("board-format", () => {
	it("treats missing formatVersion as v1", () => {
		expect(detectDashboardFormatVersion({ title: "Legacy" })).toBe(
			DASHBOARD_FORMAT_VERSION_V1
		);
	});

	it("detects v2 format versions", () => {
		expect(detectDashboardFormatVersion({ formatVersion: 2 })).toBe(
			DASHBOARD_FORMAT_VERSION_V2
		);
		expect(detectDashboardFormatVersion({ formatVersion: "v2" })).toBe(
			DASHBOARD_FORMAT_VERSION_V2
		);
	});

	it("normalizes tags from arrays and JSON strings", () => {
		expect(normalizeDashboardTags(["a", " b "])).toEqual(["a", "b"]);
		expect(normalizeDashboardTags('["llm","prod"]')).toEqual(["llm", "prod"]);
		expect(normalizeDashboardTags("")).toEqual([]);
		expect(normalizeDashboardTags(undefined)).toEqual([]);
	});

	it("imports legacy v1 dashboard JSON with tags as arrays", () => {
		const result = normalizeImportedDashboard({
			title: "LLM dashboard",
			description: "legacy",
			tags: ["llm"],
			widgets: {
				"w-1": {
					id: "w-1",
					title: "Total",
					type: "STAT_CARD",
					properties: {},
					config: { query: "SELECT 1" },
				},
			},
			layouts: {
				lg: [{ i: "w-1", x: 0, y: 0, w: 2, h: 2 }],
			},
		});

		expect("err" in result).toBe(false);
		if ("err" in result) return;
		expect(result.data.formatVersion).toBe(DASHBOARD_FORMAT_VERSION_V1);
		expect(result.data.tags).toEqual(["llm"]);
		expect(result.data.widgets["w-1"].title).toBe("Total");
		expect(result.data.layouts.lg).toEqual([
			{ i: "w-1", x: 0, y: 0, w: 2, h: 2 },
		]);
	});

	it("rejects imports without a title", () => {
		expect(normalizeImportedDashboard({ widgets: {} })).toEqual({
			err: "Dashboard import requires a title.",
		});
	});

	it("synthesizes layouts when missing", () => {
		const result = normalizeImportedDashboard({
			title: "Broken layouts",
			widgets: {
				"w-1": { id: "w-1", title: "A", type: "STAT_CARD", properties: {}, config: {} },
				"w-2": { id: "w-2", title: "B", type: "STAT_CARD", properties: {}, config: {} },
			},
		});
		expect("err" in result).toBe(false);
		if ("err" in result) return;
		expect(result.data.layouts.lg).toHaveLength(2);
		expect(result.data.layouts.lg.map((item) => item.i).sort()).toEqual([
			"w-1",
			"w-2",
		]);
	});

	it("exports v2 payloads with normalized tags", () => {
		const exported = toExportDashboardPayload({
			title: "Ops",
			description: "desc",
			isPinned: true,
			isMainDashboard: false,
			tags: '["ops"]',
			layouts: { lg: [{ i: "w-1", x: 0, y: 0, w: 1, h: 1 }] },
			widgets: {
				"w-1": {
					id: "w-1",
					title: "Count",
					description: "",
					type: "STAT_CARD",
					properties: {},
					config: { signal: "metrics", sourceId: "src-prom" },
					createdAt: "",
					updatedAt: "",
				},
			},
		});

		expect(exported.formatVersion).toBe(CURRENT_DASHBOARD_FORMAT_VERSION);
		expect(exported.tags).toEqual(["ops"]);
		expect((exported.widgets as any)["w-1"].config.sourceId).toBe("src-prom");
	});
});
