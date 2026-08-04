jest.mock("@/lib/platform/manage-dashboard/board", () => ({
	boardExistsByTitle: jest.fn(),
	importBoardLayout: jest.fn(),
	isBoardTableEmpty: jest.fn(),
}));
jest.mock("@/lib/platform/manage-dashboard/widget", () => ({
	createWidget: jest.fn(),
	getWidgets: jest.fn(),
	updateWidget: jest.fn(),
}));

import { syncWidgetSqlFromSeed } from "@/clickhouse/seed/dashboards";
import {
	createWidget,
	getWidgets,
	updateWidget,
} from "@/lib/platform/manage-dashboard/widget";

const mockCreateWidget = createWidget as jest.Mock;
const mockGetWidgets = getWidgets as jest.Mock;
const mockUpdateWidget = updateWidget as jest.Mock;

beforeEach(() => {
	jest.clearAllMocks();
});

describe("syncWidgetSqlFromSeed", () => {
	const layout = {
		widgets: {
			"missing-id": {
				id: "missing-id",
				title: "Top models",
				type: "BAR_CHART",
				properties: {},
				config: { query: "SELECT 1" },
			},
			"existing-id": {
				id: "existing-id",
				title: "Total Cost",
				type: "STAT_CARD",
				properties: { color: "#fff" },
				config: { query: "SELECT 2" },
			},
		},
	};

	it("recreates missing seeded widgets and syncs config for existing ones", async () => {
		mockGetWidgets.mockResolvedValue({
			data: [{ id: "existing-id", title: "Total Cost", type: "STAT_CARD" }],
			err: null,
		});
		mockCreateWidget.mockResolvedValue({ data: { id: "missing-id" } });
		mockUpdateWidget.mockResolvedValue({ data: "ok" });

		await syncWidgetSqlFromSeed(layout, "db-1");

		expect(mockGetWidgets).toHaveBeenCalledWith(
			["missing-id", "existing-id"],
			"db-1"
		);
		expect(mockCreateWidget).toHaveBeenCalledWith(
			expect.objectContaining({
				id: "missing-id",
				title: "Top models",
				type: "BAR_CHART",
			}),
			"db-1"
		);
		expect(mockUpdateWidget).toHaveBeenCalledWith(
			{ id: "existing-id", config: { query: "SELECT 2" } },
			"db-1"
		);
		expect(mockUpdateWidget).not.toHaveBeenCalledWith(
			expect.objectContaining({ id: "missing-id" }),
			expect.anything()
		);
	});

	it("throws when recreating a missing widget fails", async () => {
		mockGetWidgets.mockResolvedValue({ data: [], err: null });
		mockCreateWidget.mockResolvedValue({ err: "insert failed" });

		await expect(syncWidgetSqlFromSeed(layout, "db-1")).rejects.toThrow(
			/Failed to recreate missing seeded widget missing-id/
		);
	});
});
