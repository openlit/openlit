jest.mock("@/lib/session", () => ({
	getCurrentUser: jest.fn(),
}));
jest.mock("@/lib/platform/manage-dashboard/widget", () => ({
	runWidgetQuery: jest.fn(),
}));
jest.mock("@/lib/posthog", () => ({
	__esModule: true,
	default: { fireEvent: jest.fn() },
}));

import { POST } from "@/app/api/manage-dashboard/query/run/route";
import { getCurrentUser } from "@/lib/session";
import { runWidgetQuery } from "@/lib/platform/manage-dashboard/widget";

(globalThis as unknown as { Response: { json: unknown } }).Response = {
	json: (body: unknown, init?: ResponseInit) => ({
		status: init?.status ?? 200,
		json: async () => body,
	}),
};

function jsonRequest(body: unknown) {
	return {
		json: jest.fn().mockResolvedValue(body),
	} as unknown as Request;
}

function invalidJsonRequest() {
	return {
		json: jest.fn().mockRejectedValue(new Error("bad json")),
	} as unknown as Request;
}

describe("manage-dashboard query/run route", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		(getCurrentUser as jest.Mock).mockResolvedValue({ id: "user1" });
		(runWidgetQuery as jest.Mock).mockResolvedValue({ data: [] });
	});

	it("requires authentication", async () => {
		(getCurrentUser as jest.Mock).mockResolvedValue(null);

		const response = await POST(
			jsonRequest({
				widgetId: "w1",
				filter: {},
			}) as never
		);

		expect(response.status).toBe(401);
		expect(runWidgetQuery).not.toHaveBeenCalled();
	});

	it("rejects invalid JSON", async () => {
		const response = await POST(invalidJsonRequest() as never);
		expect(response.status).toBe(400);
		expect(runWidgetQuery).not.toHaveBeenCalled();
	});

	it("rejects a missing widgetId", async () => {
		const response = await POST(jsonRequest({ filter: {} }) as never);
		expect(response.status).toBe(400);
		expect(runWidgetQuery).not.toHaveBeenCalled();
	});

	it("runs the widget query when authenticated", async () => {
		const response = await POST(
			jsonRequest({
				widgetId: "w1",
				filter: { timeLimit: { start: "", end: "" } },
				sourceId: "src-1",
				signal: "traces",
			}) as never
		);

		expect(response.status).toBe(200);
		expect(runWidgetQuery).toHaveBeenCalledWith("w1", {
			userQuery: undefined,
			filter: { timeLimit: { start: "", end: "" } },
			sourceId: "src-1",
			signal: "traces",
		});
	});
});
