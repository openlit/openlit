import { render, screen } from "@testing-library/react";
import GroupedTable from "@/components/(playground)/request/grouped-table";
import { getData } from "@/utils/api";
import { getFilterDetails, getUpdateFilter } from "@/selectors/filter";
import { getPingStatus } from "@/selectors/database-config";
import { useRootStore } from "@/store";

jest.mock("@/utils/api", () => ({
	...jest.requireActual("@/utils/api"),
	getData: jest.fn(),
}));

jest.mock("@/store", () => ({ useRootStore: jest.fn() }));

const mockGetData = getData as jest.MockedFunction<typeof getData>;

const filter = {
	filterReady: true,
	groupValue: "",
	timeLimit: {
		start: new Date("2026-07-01T00:00:00Z"),
		end: new Date("2026-07-01T01:00:00Z"),
	},
};

beforeEach(() => {
	mockGetData.mockReset();
	(useRootStore as unknown as jest.Mock).mockImplementation((selector) => {
		if (selector === getFilterDetails) return filter;
		if (selector === getUpdateFilter) return jest.fn();
		if (selector === getPingStatus) return "success";
		return undefined;
	});
});

describe("GroupedTable", () => {
	it("shows the grouped query error instead of an empty result", async () => {
		mockGetData.mockResolvedValue({ err: "Tempo metrics query failed", data: [] });

		render(<GroupedTable groupBy="spanName" />);

		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Tempo metrics query failed"
		);
		expect(
			screen.queryByText("No data found for the selected filters.")
		).not.toBeInTheDocument();
	});

	it("renders the groups when the query succeeds", async () => {
		mockGetData.mockResolvedValue({
			err: null,
			data: [
				{
					group_value: "chat gpt-4o",
					count: 12,
					total_cost: 0,
					total_tokens: 0,
					avg_duration_seconds: 0,
				},
			],
		});

		render(<GroupedTable groupBy="spanName" />);

		expect(await screen.findByText("chat gpt-4o")).toBeInTheDocument();
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
	});
});
