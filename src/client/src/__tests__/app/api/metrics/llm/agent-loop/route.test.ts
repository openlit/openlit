jest.mock("@/lib/platform/llm/agent-loop", () => ({
	getAgentLoop: jest.fn(),
}));

jest.mock("@/helpers/server/platform", () => ({
	validateMetricsRequest: jest.fn(),
	validateMetricsRequestType: {
		AGENT_LOOP: "AGENT_LOOP",
	},
}));

jest.mock("@/lib/session", () => ({
	getCurrentUser: jest.fn(async () => ({ id: "user-1" })),
}));

jest.mock("@/lib/organisation", () => ({
	getCurrentOrganisation: jest.fn(async () => null),
	getCurrentProjectForOrganisation: jest.fn(async () => null),
}));

class TestResponse {
	status: number;
	private body: unknown;

	constructor(body?: unknown, init?: { status?: number }) {
		this.body = body;
		this.status = init?.status ?? 200;
	}

	static json(body: unknown, init?: { status?: number }) {
		return new TestResponse(body, init);
	}

	async json() {
		return this.body;
	}
}

(global as any).Response = TestResponse;

import { POST } from "@/app/api/metrics/llm/agent-loop/route";
import { getAgentLoop } from "@/lib/platform/llm/agent-loop";
import {
	validateMetricsRequest,
	validateMetricsRequestType,
} from "@/helpers/server/platform";
import getMessage from "@/constants/messages";

function makeRequest(body: unknown) {
	return {
		json: async () => body,
		headers: { get: () => null },
	} as any;
}

describe("POST /api/metrics/llm/agent-loop", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("returns 400 for invalid JSON", async () => {
		const request = {
			json: async () => {
				throw new Error("bad json");
			},
			headers: { get: () => null },
		} as any;

		const res = await POST(request);
		expect(res.status).toBe(400);
		expect(await res.json()).toBe(getMessage().TELEMETRY_SOURCE_INVALID_JSON);
	});

	it("returns 400 when timeLimit is missing", async () => {
		(validateMetricsRequest as jest.Mock).mockReturnValue({
			success: false,
			err: "Start date or End date missing!",
		});

		const res = await POST(makeRequest({}));
		expect(res.status).toBe(400);
		expect(validateMetricsRequest).toHaveBeenCalledWith(
			expect.objectContaining({ timeLimit: undefined }),
			validateMetricsRequestType.AGENT_LOOP
		);
	});

	it("returns agent loop stats on success", async () => {
		(validateMetricsRequest as jest.Mock).mockReturnValue({ success: true });
		(getAgentLoop as jest.Mock).mockResolvedValue({
			data: [{ loops: 3, tool_traces: 25, loops_pct: 12 }],
		});

		const res = await POST(
			makeRequest({
				timeLimit: { start: "2024-01-01", end: "2024-01-02" },
			})
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			data: [{ loops: 3, tool_traces: 25, loops_pct: 12 }],
		});
	});
});
