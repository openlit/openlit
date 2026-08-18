import { configuredConnectorMatches } from "@/lib/platform/connectors/list-filters";

const base = {
	query: "",
	typeFilter: "all",
	categoryFilter: "all",
	signalFilter: "all",
	type: "mem0",
	category: "memory",
	signals: [] as string[],
	searchText: "Prod Mem0 mem0 memory",
};

describe("configuredConnectorMatches", () => {
	it("matches every connector when search and filters are empty", () => {
		expect(configuredConnectorMatches(base)).toBe(true);
	});

	it("matches by name search", () => {
		expect(configuredConnectorMatches({ ...base, query: "mem0" })).toBe(true);
		expect(configuredConnectorMatches({ ...base, query: "tempo" })).toBe(false);
	});

	it("filters by type, category, and signal", () => {
		expect(configuredConnectorMatches({ ...base, typeFilter: "mem0" })).toBe(true);
		expect(configuredConnectorMatches({ ...base, typeFilter: "zep" })).toBe(false);
		expect(
			configuredConnectorMatches({ ...base, categoryFilter: "memory" })
		).toBe(true);
		expect(
			configuredConnectorMatches({ ...base, categoryFilter: "datasource" })
		).toBe(false);
		expect(
			configuredConnectorMatches({
				...base,
				type: "tempo",
				category: "datasource",
				signals: ["traces"],
				searchText: "Tempo tempo traces",
				signalFilter: "traces",
			})
		).toBe(true);
		expect(
			configuredConnectorMatches({
				...base,
				type: "tempo",
				category: "datasource",
				signals: ["traces"],
				searchText: "Tempo tempo traces",
				signalFilter: "logs",
			})
		).toBe(false);
	});
});
