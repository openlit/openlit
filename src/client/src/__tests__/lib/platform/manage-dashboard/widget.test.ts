jest.mock("@/lib/platform/common", () => ({
	dataCollector: jest.fn(),
}));
jest.mock("@/lib/platform/manage-dashboard/table-details", () => ({
	OPENLIT_WIDGET_TABLE_NAME: "openlit_widgets",
	OPENLIT_BOARD_WIDGET_TABLE_NAME: "openlit_board_widgets",
}));
jest.mock("@/constants/messages", () => ({
	__esModule: true,
	default: jest.fn(() => ({
		WIDGET_FETCH_FAILED: "Widget fetch failed",
		WIDGET_RUN_FAILED: "Widget run failed",
	})),
}));
jest.mock("@/utils/sanitizer", () => ({
	__esModule: true,
	default: {
		sanitizeValue: jest.fn((value: string) => value),
	},
}));
jest.mock("@/helpers/server/widget", () => ({
	normalizeWidgetToClient: jest.fn((widget: any) => ({
		...widget,
		config:
			typeof widget?.config === "string"
				? JSON.parse(widget.config)
				: widget?.config,
	})),
	sanitizeWidget: jest.fn((widget: any) => widget),
	escapeSingleQuotes: jest.fn((value: string) => value.replace(/'/g, "\\'")),
}));

import { runWidgetQuery } from "@/lib/platform/manage-dashboard/widget";
import { dataCollector } from "@/lib/platform/common";

beforeEach(() => {
	jest.clearAllMocks();
	(dataCollector as jest.Mock).mockResolvedValue({ data: [], err: null });
});

describe("runWidgetQuery", () => {
	it("blocks non-SELECT user queries", async () => {
		(dataCollector as jest.Mock).mockResolvedValueOnce({
			data: [{ id: "w1", config: JSON.stringify({ query: "SELECT 1" }) }],
			err: null,
		});

		const result = await runWidgetQuery("w1", {
			userQuery: "DROP TABLE otel_traces",
			filter: {} as any,
		});

		expect(result).toEqual({ err: "Only SELECT queries are allowed" });
		expect(dataCollector).toHaveBeenCalledTimes(1);
	});

	it("blocks dangerous ClickHouse functions in user queries", async () => {
		(dataCollector as jest.Mock).mockResolvedValueOnce({
			data: [{ id: "w1", config: JSON.stringify({ query: "SELECT 1" }) }],
			err: null,
		});

		const result = await runWidgetQuery("w1", {
			userQuery: "SELECT * FROM url('https://example.com')",
			filter: {} as any,
		});

		expect(result).toEqual({ err: "Query contains disallowed functions" });
		expect(dataCollector).toHaveBeenCalledTimes(1);
	});

	it("runs allowed SELECT user queries in readonly mode", async () => {
		(dataCollector as jest.Mock)
			.mockResolvedValueOnce({
				data: [{ id: "w1", config: JSON.stringify({ query: "SELECT 1" }) }],
				err: null,
			})
			.mockResolvedValueOnce({ data: [{ count: 1 }], err: null });

		const result = await runWidgetQuery("w1", {
			userQuery: "SELECT count() FROM otel_traces",
			filter: {} as any,
		});

		expect(result).toEqual({ data: [{ count: 1 }] });
		expect(dataCollector).toHaveBeenLastCalledWith(
			{ query: "SELECT count() FROM otel_traces", enable_readonly: true }
		);
	});
});
