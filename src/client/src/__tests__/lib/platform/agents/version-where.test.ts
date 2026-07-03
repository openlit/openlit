import { buildVersionWhereClause } from "@/lib/platform/agents/version-where";

describe("buildVersionWhereClause", () => {
	it("returns an empty clause when no version filter is provided", () => {
		expect(buildVersionWhereClause(null)).toBe("");
		expect(buildVersionWhereClause(undefined)).toBe("");
		expect(
			buildVersionWhereClause({
				versionHash: "",
				firstSeen: "2026-01-01T00:00:00Z",
				lastSeen: "2026-01-02T00:00:00Z",
				hasAttributeSpans: false,
			})
		).toBe("");
	});

	it("builds a time-window fallback for unstamped spans", () => {
		const clause = buildVersionWhereClause({
			versionHash: "v1",
			firstSeen: "2026-01-01T12:34:56.789Z",
			lastSeen: new Date("2026-01-02T01:02:03.000Z") as any,
			hasAttributeSpans: false,
		});

		expect(clause).toBe(
			"(Timestamp BETWEEN parseDateTimeBestEffort('2026-01-01 12:34:56') AND parseDateTimeBestEffort('2026-01-02 01:02:03'))"
		);
	});

	it("combines exact hash matches with fallback windows for stamped versions", () => {
		const clause = buildVersionWhereClause({
			versionHash: "v'1",
			firstSeen: "not-a-date",
			lastSeen: "2026-01-02 01:02:03",
			hasAttributeSpans: true,
		});

		expect(clause).toContain("SpanAttributes['openlit.agent.version_hash'] = 'v\\'1'");
		expect(clause).toContain("SpanAttributes['openlit.agent.version_hash'] = ''");
		expect(clause).toContain("Timestamp BETWEEN parseDateTimeBestEffort");
	});
});
