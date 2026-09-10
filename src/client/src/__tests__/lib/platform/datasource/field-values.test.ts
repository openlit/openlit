const mockResolveSignalReadContext = jest.fn();
const mockPlanAndDistinctValues = jest.fn();

jest.mock("@/lib/platform/connectors/datasource/facade", () => ({
	resolveSignalReadContext: (...args: unknown[]) =>
		mockResolveSignalReadContext(...args),
	facadeErrorMessage: (error: unknown) =>
		error instanceof Error ? error.message : String(error),
}));
jest.mock("@/lib/platform/connectors/datasource/query-planner", () => ({
	planAndDistinctValues: (...args: unknown[]) =>
		mockPlanAndDistinctValues(...args),
}));
jest.mock("@/lib/platform/connectors/datasource/clickhouse/query-map", () => ({
	metricParamsToOpenLITQuery: (_params: unknown, signal: string) => ({
		signal,
		timeRange: {},
	}),
}));

import { getSignalFieldValues } from "@/lib/platform/connectors/datasource/field-values";

describe("getSignalFieldValues", () => {
	it("resolves the selected signal adapter and returns unique sorted values", async () => {
		const adapter = { type: "tempo" };
		mockResolveSignalReadContext.mockResolvedValue({ adapter });
		mockPlanAndDistinctValues.mockResolvedValue(["zeta", "alpha", "alpha"]);

		const result = await getSignalFieldValues(
			"traces",
			"service.name",
			{ timeLimit: {} } as any
		);

		expect(mockResolveSignalReadContext).toHaveBeenCalledWith(
			"traces",
			expect.any(Object)
		);
		expect(mockPlanAndDistinctValues).toHaveBeenCalledWith(
			adapter,
			"service.name",
			expect.objectContaining({ signal: "traces" })
		);
		expect(result).toEqual({ err: null, values: ["alpha", "zeta"] });
	});
});
