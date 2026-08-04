jest.mock("@/lib/platform/common", () => ({
	dataCollector: jest.fn(),
}));
jest.mock("@/lib/platform/manage-dashboard/table-details", () => ({
	OPENLIT_BOARD_TABLE_NAME: "openlit_board",
	OPENLIT_BOARD_WIDGET_TABLE_NAME: "openlit_board_widget",
	OPENLIT_WIDGET_TABLE_NAME: "openlit_widget",
}));
jest.mock("@/constants/messages", () => ({
	__esModule: true,
	default: jest.fn(() => ({
		BOARD_CREATE_FAILED: "Board create failed!",
		BOARD_DELETE_FAILED: "Board delete failed!",
		BOARD_DELETED_SUCCESSFULLY: "Board deleted successfully!",
		BOARD_DATA_NOT_FOUND: "Board data not found!",
		BOARD_IMPORT_FAILED: "Board import failed!",
		BOARD_LAYOUT_UPDATED_SUCCESSFULLY: "Board layout updated successfully!",
		BOARD_UPDATE_FAILED: "Board update failed!",
		BOARD_UPDATED_SUCCESSFULLY: "Board updated successfully!",
		MAIN_DASHBOARD_NOT_FOUND: "Main dashboard not found!",
		WIDGET_CREATE_FAILED: "Widget create failed!",
		WIDGET_FETCH_FAILED: "Widget fetch failed!",
	})),
}));
jest.mock("@/utils/sanitizer", () => ({
	__esModule: true,
	default: {
		sanitizeValue: jest.fn((value: string) => value),
		sanitizeObject: jest.fn((value: unknown) => value),
	},
}));
jest.mock("@/helpers/server/widget", () => ({
	normalizeWidgetToClient: jest.fn((widget: any) => widget),
	sanitizeWidget: jest.fn((widget: any) => widget),
	escapeSingleQuotes: jest.fn((value: string) => value),
}));
jest.mock("@/lib/platform/manage-dashboard/widget", () => ({
	createWidget: jest.fn(),
	deleteWidget: jest.fn(),
	getWidgets: jest.fn(),
}));

import { dataCollector } from "@/lib/platform/common";
import {
	getBoardLayout,
	importBoardLayout,
} from "@/lib/platform/manage-dashboard/board";
import {
	createWidget,
	deleteWidget,
	getWidgets,
} from "@/lib/platform/manage-dashboard/widget";

const mockDataCollector = dataCollector as jest.Mock;
const mockCreateWidget = createWidget as jest.Mock;
const mockDeleteWidget = deleteWidget as jest.Mock;
const mockGetWidgets = getWidgets as jest.Mock;

beforeEach(() => {
	jest.clearAllMocks();
	mockDeleteWidget.mockResolvedValue({ data: true, err: null });
});

describe("getBoardLayout", () => {
	it("omits dangling board_widget mappings whose widget row is missing", async () => {
		mockDataCollector
			.mockResolvedValueOnce({
				data: [
					{
						boardId: "board-1",
						boardTitle: "LLM dashboard",
						boardDescription: "",
						isMainDashboard: true,
						isPinned: false,
						boardCreatedAt: "2026-01-01",
						boardUpdatedAt: "2026-01-01",
						tags: "[]",
					},
				],
				err: null,
			})
			.mockResolvedValueOnce({
				data: [
					{
						boardWidgetId: "bw-ok",
						widgetId: "widget-ok",
						position: JSON.stringify({ x: 0, y: 0, w: 2, h: 2 }),
						boardWidgetCreatedAt: "2026-01-01",
						boardWidgetUpdatedAt: "2026-01-01",
					},
					{
						boardWidgetId: "bw-dangling",
						widgetId: "widget-missing",
						position: JSON.stringify({ x: 2, y: 0, w: 2, h: 2 }),
						boardWidgetCreatedAt: "2026-01-01",
						boardWidgetUpdatedAt: "2026-01-01",
					},
				],
				err: null,
			});

		mockGetWidgets.mockResolvedValue({
			data: [
				{
					id: "widget-ok",
					title: "Total Requests",
					description: "ok",
					type: "STAT_CARD",
					properties: {},
					config: { query: "SELECT 1" },
					createdAt: "2026-01-01",
					updatedAt: "2026-01-01",
				},
			],
			err: null,
		});

		const result = await getBoardLayout("board-1", "db-1");

		expect(mockGetWidgets).toHaveBeenCalledWith(
			["widget-ok", "widget-missing"],
			"db-1"
		);
		expect(result.err).toBeUndefined();
		expect(result.data?.layouts.lg).toEqual([
			{ i: "widget-ok", x: 0, y: 0, w: 2, h: 2 },
		]);
		expect(Object.keys(result.data?.widgets || {})).toEqual(["widget-ok"]);
		expect(result.data?.widgets["widget-ok"].type).toBe("STAT_CARD");
		expect(result.data?.widgets["widget-missing"]).toBeUndefined();
	});
});

describe("importBoardLayout", () => {
	const importPayload = {
		title: "LLM dashboard",
		description: "desc",
		isPinned: false,
		isMainDashboard: true,
		tags: "[]",
		layouts: {
			lg: [
				{ i: "seed-w1", x: 0, y: 0, w: 2, h: 2 },
				{ i: "seed-w2", x: 2, y: 0, w: 2, h: 2 },
			],
		},
		widgets: {
			"seed-w1": {
				id: "seed-w1",
				title: "W1",
				type: "STAT_CARD",
				properties: {},
				config: {},
			},
			"seed-w2": {
				id: "seed-w2",
				title: "W2",
				type: "STAT_CARD",
				properties: {},
				config: {},
			},
		},
	};

	it("does not write board_widget rows when any createWidget fails, and rolls back", async () => {
		mockDataCollector
			// getMainDashboard
			.mockResolvedValueOnce({
				data: [{ id: "main", isMainDashboard: true }],
				err: null,
			})
			// createBoard insert
			.mockResolvedValueOnce({
				data: { query_id: "q1" },
				err: null,
			})
			// deleteBoard: board_widget mappings
			.mockResolvedValueOnce({ data: { query_id: "del-bw" }, err: null })
			// deleteBoard: board row
			.mockResolvedValueOnce({ data: { query_id: "del-b" }, err: null });

		mockCreateWidget
			.mockResolvedValueOnce({ data: { id: "seed-w1" } })
			.mockResolvedValueOnce({ err: "Widget create failed!" });

		const result = await importBoardLayout(importPayload, "db-1", {
			preserveWidgetIds: true,
		});

		expect(result).toEqual({ err: "Widget create failed!" });
		expect(mockCreateWidget).toHaveBeenCalledTimes(2);
		// deleteBoard: board_widget delete + board delete
		expect(mockDataCollector).toHaveBeenCalledWith(
			expect.objectContaining({
				query: expect.stringContaining("DELETE FROM openlit_board_widget"),
			}),
			"exec",
			"db-1"
		);
		expect(mockDataCollector).toHaveBeenCalledWith(
			expect.objectContaining({
				query: expect.stringContaining("DELETE FROM openlit_board"),
			}),
			"exec",
			"db-1"
		);
		expect(mockDeleteWidget).toHaveBeenCalledWith("seed-w1", "db-1");
		// Never reached updateBoardLayout's existing-widgets SELECT
		expect(mockDataCollector).not.toHaveBeenCalledWith(
			expect.objectContaining({
				query: expect.stringContaining("SELECT widget_id, id"),
			}),
			"query",
			"db-1"
		);
	});

	it("attaches layout when every createWidget succeeds", async () => {
		mockDataCollector
			// getMainDashboard
			.mockResolvedValueOnce({
				data: [{ id: "main", isMainDashboard: true }],
				err: null,
			})
			// createBoard insert
			.mockResolvedValueOnce({
				data: { query_id: "q1" },
				err: null,
			})
			// updateBoardLayout: existing mappings
			.mockResolvedValueOnce({
				data: [],
				err: null,
			})
			// updateBoardLayout: insert mapping 1
			.mockResolvedValueOnce({ data: { query_id: "ins1" }, err: null })
			// updateBoardLayout: insert mapping 2
			.mockResolvedValueOnce({ data: { query_id: "ins2" }, err: null });

		mockCreateWidget
			.mockResolvedValueOnce({ data: { id: "seed-w1" } })
			.mockResolvedValueOnce({ data: { id: "seed-w2" } });

		const result = await importBoardLayout(importPayload, "db-1", {
			preserveWidgetIds: true,
		});

		expect(result.err).toBeUndefined();
		expect(result.data?.title).toBe("LLM dashboard");
		expect(mockDeleteWidget).not.toHaveBeenCalled();
		expect(mockDataCollector).toHaveBeenCalledWith(
			expect.objectContaining({
				table: "openlit_board_widget",
			}),
			"insert",
			"db-1"
		);
	});
});
