jest.mock("crypto", () => ({ randomUUID: jest.fn(() => "run-1") }));
jest.mock("@/lib/platform/common", () => ({ dataCollector: jest.fn() }));
jest.mock("@/lib/platform/chat/table-details", () => ({
	OPENLIT_OTTER_RUNS_TABLE: "openlit_otter_runs",
}));
jest.mock("@/utils/sanitizer", () => ({
	__esModule: true,
	default: {
		sanitizeValue: jest.fn((value: unknown) => String(value)),
	},
}));

import { dataCollector } from "@/lib/platform/common";
import { saveOtterRun } from "@/lib/platform/chat/otter-runs";
import Sanitizer from "@/utils/sanitizer";

beforeEach(() => {
	jest.clearAllMocks();
	(dataCollector as jest.Mock).mockResolvedValue({ err: null });
});

describe("saveOtterRun", () => {
	it("inserts a prompt improvement run into the otter runs table", async () => {
		const { data } = await saveOtterRun(
			{
				runType: "prompt_improvement",
				targetType: "prompt",
				targetId: "prompt-1",
				inputSnapshot: "Original prompt",
				resultJson: JSON.stringify({ suggestions: [] }),
				summary: "Prompt improvement generated 0 suggestions.",
				modelProvider: "openai",
				modelName: "gpt-4o",
				promptTokens: 12,
				completionTokens: 8,
				cost: 0.004,
				meta: { source: "prompt_edit", suggestionCount: 0 },
			},
			"db-1"
		);

		expect(data).toBe("run-1");
		expect(dataCollector).toHaveBeenCalledWith(
			{
				table: "openlit_otter_runs",
				values: [
					expect.objectContaining({
						id: "run-1",
						run_type: "prompt_improvement",
						target_type: "prompt",
						target_id: "prompt-1",
						input_snapshot: "Original prompt",
						result_json: JSON.stringify({ suggestions: [] }),
						summary: "Prompt improvement generated 0 suggestions.",
						model_provider: "openai",
						model_name: "gpt-4o",
						prompt_tokens: 12,
						completion_tokens: 8,
						cost: 0.004,
						meta: JSON.stringify({ source: "prompt_edit", suggestionCount: 0 }),
					}),
				],
			},
			"insert",
			"db-1"
		);
		expect(Sanitizer.sanitizeValue).toHaveBeenCalledWith("prompt_improvement");
	});

	it("returns insert errors without a data id", async () => {
		(dataCollector as jest.Mock).mockResolvedValueOnce({ err: "insert failed" });

		const result = await saveOtterRun({
			runType: "prompt_improvement",
			targetType: "unsaved_prompt",
		});

		expect(result).toEqual({ err: "insert failed" });
	});
});
