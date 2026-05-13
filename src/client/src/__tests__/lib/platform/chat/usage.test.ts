jest.mock("@/lib/platform/common", () => ({ dataCollector: jest.fn() }));
jest.mock("@/lib/platform/chat/table-details", () => ({
	OPENLIT_CHAT_CONVERSATION_TABLE: "openlit_chat_conversation",
	OPENLIT_CHAT_MESSAGE_TABLE: "openlit_chat_message",
	OPENLIT_TRACE_ANALYSIS_TABLE: "openlit_trace_analysis",
}));

import { dataCollector } from "@/lib/platform/common";
import { getOtterUsage } from "@/lib/platform/chat/usage";

beforeEach(() => {
	jest.clearAllMocks();
});

describe("getOtterUsage", () => {
	it("combines chat and analysis usage with provider/model attribution", async () => {
		(dataCollector as jest.Mock)
			.mockResolvedValueOnce({
				data: [{
					totalConversations: 4,
					totalMessages: 12,
					promptTokens: 400,
					completionTokens: 200,
					cost: 0.02,
				}],
			})
			.mockResolvedValueOnce({
				data: [{
					id: "chat-1",
					conversationId: "conversation-1",
					title: "Revenue dashboard",
					provider: "openai",
					model: "gpt-4o-mini",
					promptTokens: 100,
					completionTokens: 50,
					cost: 0.001,
					messageCount: 2,
					createdAt: "2026-01-01T00:00:00Z",
					updatedAt: "2026-01-01T00:01:00Z",
				}],
			})
			.mockResolvedValueOnce({
				data: [{
					id: "analysis-1",
					analysisType: "trace_analysis",
					rootSpanId: "root-1",
					selectedSpanId: "span-1",
					runNumber: 1,
					summary: "Trace post-mortem",
					modelProvider: "anthropic",
					modelName: "claude-sonnet",
					promptTokens: 200,
					completionTokens: 75,
					cost: 0.005,
					createdAt: "2026-01-01T00:02:00Z",
				}],
			});

		const { data } = await getOtterUsage("db-1");

		expect(data!.items).toHaveLength(2);
		expect(data!.items[0]).toMatchObject({
			usageType: "trace_analysis",
			location: "Trace hierarchy AI analysis",
			provider: "anthropic",
			model: "claude-sonnet",
			referenceId: "root-1",
		});
		expect(data!.items[1]).toMatchObject({
			usageType: "chat",
			location: "Otter chat",
			summary: "Revenue dashboard",
			provider: "openai",
			model: "gpt-4o-mini",
			referenceId: "conversation-1",
		});
		expect(data!.totals).toEqual({
			promptTokens: 300,
			completionTokens: 125,
			totalTokens: 425,
			cost: 0.006,
			runCount: 2,
		});
		expect(data!.chatMetrics).toEqual({
			totalConversations: 4,
			totalMessages: 12,
			promptTokens: 400,
			completionTokens: 200,
			totalTokens: 600,
			cost: 0.02,
			avgTokensPerConversation: 150,
			avgCostPerConversation: 0.005,
		});
		expect(data!.byProviderModel).toEqual([
			expect.objectContaining({
				provider: "anthropic",
				model: "claude-sonnet",
				totalTokens: 275,
				cost: 0.005,
			}),
			expect.objectContaining({
				provider: "openai",
				model: "gpt-4o-mini",
				totalTokens: 150,
				cost: 0.001,
			}),
		]);
		expect(dataCollector).toHaveBeenCalledWith(expect.any(Object), "query", "db-1");
	});

	it("returns usage from the available source when the other query fails", async () => {
		(dataCollector as jest.Mock)
			.mockResolvedValueOnce({ err: "missing chat table" })
			.mockResolvedValueOnce({ err: "missing chat message table" })
			.mockResolvedValueOnce({
				data: [{
					id: "analysis-1",
					analysisType: "span_analysis",
					rootSpanId: "span-1",
					selectedSpanId: "span-1",
					runNumber: 1,
					summary: "Span post-mortem",
					modelProvider: "openai",
					modelName: "gpt-4o",
					promptTokens: 10,
					completionTokens: 5,
					cost: 0.001,
					createdAt: "2026-01-01T00:02:00Z",
				}],
			});

		const { data } = await getOtterUsage();

		expect(data!.items).toHaveLength(1);
		expect(data!.items[0]).toMatchObject({
			usageType: "span_analysis",
			location: "Individual span AI analysis",
			referenceId: "span-1",
		});
	});

	it("adds the selected date range to usage queries", async () => {
		(dataCollector as jest.Mock)
			.mockResolvedValueOnce({ data: [] })
			.mockResolvedValueOnce({ data: [] })
			.mockResolvedValueOnce({ data: [] });

		await getOtterUsage("db-1", {
			start: "2026-01-01T00:00:00.000Z",
			end: "2026-01-02T00:00:00.000Z",
		});

		for (const [payload] of (dataCollector as jest.Mock).mock.calls) {
			expect(payload.query).toContain("2026-01-01T00:00:00.000Z");
			expect(payload.query).toContain("2026-01-02T00:00:00.000Z");
		}
	});
});
