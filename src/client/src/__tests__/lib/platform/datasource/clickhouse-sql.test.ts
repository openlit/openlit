import {
	qualifiedTracesTable,
	quoteClickHouseIdentifier,
} from "@/lib/platform/connectors/datasource/clickhouse/sql";

describe("clickhouse sql helpers", () => {
	it("quotes identifiers safely", () => {
		expect(quoteClickHouseIdentifier("otel_traces")).toBe("`otel_traces`");
		expect(qualifiedTracesTable("openlit")).toBe("`openlit`.`otel_traces`");
	});

	it("rejects unsafe identifiers", () => {
		expect(() => quoteClickHouseIdentifier("bad-id")).toThrow(
			"Invalid ClickHouse identifier"
		);
	});
});
