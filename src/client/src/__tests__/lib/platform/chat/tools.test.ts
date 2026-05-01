jest.mock("ai", () => ({
	tool: jest.fn((config) => config),
	jsonSchema: jest.fn((schema) => schema),
}));

jest.mock("@/lib/platform/rule-engine", () => ({
	createRule: jest.fn(),
	updateRule: jest.fn(),
	deleteRule: jest.fn(),
	getRules: jest.fn(),
	getRuleById: jest.fn(),
	addConditionGroupsToRule: jest.fn(),
	addRuleEntity: jest.fn(),
	deleteRuleEntity: jest.fn(),
	getRuleEntities: jest.fn(),
}));

jest.mock("@/lib/platform/context", () => ({
	createContext: jest.fn(),
	updateContext: jest.fn(),
	deleteContext: jest.fn(),
	getContexts: jest.fn(),
}));

jest.mock("@/lib/platform/prompt", () => ({
	createPrompt: jest.fn(),
	getPrompts: jest.fn(),
	deletePrompt: jest.fn(),
}));

jest.mock("@/lib/platform/prompt/version", () => ({
	upsertPromptVersion: jest.fn(),
}));

jest.mock("@/lib/platform/vault", () => ({
	upsertSecret: jest.fn(),
	deleteSecret: jest.fn(),
	getSecrets: jest.fn(),
}));

jest.mock("@/lib/platform/providers/models-service", () => ({
	createCustomModel: jest.fn(),
	updateCustomModel: jest.fn(),
	deleteCustomModel: jest.fn(),
	getCustomModels: jest.fn(),
}));

import { getChatTools } from "@/lib/platform/chat/tools";
import { createRule, deleteRule, getRules } from "@/lib/platform/rule-engine";
import { upsertSecret } from "@/lib/platform/vault";
import {
	createCustomModel,
	getCustomModels,
} from "@/lib/platform/providers/models-service";

describe("getChatTools", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("builds the expected tool set", () => {
		const tools = getChatTools("user-1", "db-1");

		expect(Object.keys(tools)).toEqual(
			expect.arrayContaining([
				"create_rule",
				"list_rules",
				"create_context",
				"create_prompt",
				"create_vault_secret",
				"create_custom_model",
				"list_custom_models",
			])
		);
		expect(tools.create_rule.inputSchema.required).toEqual(["name"]);
		expect(tools.create_vault_secret.inputSchema.required).toEqual([
			"key",
			"value",
		]);
	});

	it("creates a rule and adds condition groups when provided", async () => {
		(createRule as jest.Mock).mockResolvedValue({ id: "rule-1" });
		const tools = getChatTools("user-1", "db-1");

		await expect(
			tools.create_rule.execute({
				name: "Latency rule",
				condition_groups: [{ conditions: [] }],
			})
		).resolves.toEqual(
			expect.objectContaining({
				success: true,
				message: "Rule created",
			})
		);
		expect(createRule).toHaveBeenCalledWith({
			name: "Latency rule",
			description: "",
			group_operator: "AND",
			status: "ACTIVE",
		});
	});

	it("returns rule operation errors without throwing", async () => {
		(deleteRule as jest.Mock).mockResolvedValue(["delete failed"]);
		(getRules as jest.Mock).mockResolvedValue({ err: "list failed" });
		const tools = getChatTools("user-1", "db-1");

		await expect(tools.delete_rule.execute({ id: "rule-1" })).resolves.toEqual({
			success: false,
			error: "delete failed",
		});
		await expect(tools.list_rules.execute({})).resolves.toEqual({
			success: false,
			error: "list failed",
		});
	});

	it("normalizes vault keys before storing secrets", async () => {
		(upsertSecret as jest.Mock).mockResolvedValue(undefined);
		const tools = getChatTools("user-1", "db-1");

		await expect(
			tools.create_vault_secret.execute({
				key: "OpenAI API.key",
				value: "sk-test",
				tags: ["llm"],
			})
		).resolves.toEqual(
			expect.objectContaining({
				success: true,
				details: expect.stringContaining('Key: "OPEN_AI_API_KEY"'),
			})
		);
		expect(upsertSecret).toHaveBeenCalledWith({
			key: "OPEN_AI_API_KEY",
			value: "sk-test",
			tags: ["llm"],
		});
	});

	it("passes user and database config ids to custom model operations", async () => {
		(createCustomModel as jest.Mock).mockResolvedValue({
			data: { id: "model-1" },
		});
		(getCustomModels as jest.Mock).mockResolvedValue({
			data: [{ id: "model-1", model_id: "custom-model", provider: "openai" }],
		});
		const tools = getChatTools("user-1", "db-1");

		await expect(
			tools.create_custom_model.execute({
				provider: "openai",
				model_id: "custom-model",
				display_name: "Custom Model",
			})
		).resolves.toEqual(
			expect.objectContaining({
				success: true,
				id: "model-1",
			})
		);
		expect(createCustomModel).toHaveBeenCalledWith(
			"user-1",
			"db-1",
			expect.objectContaining({
				provider: "openai",
				model_id: "custom-model",
				displayName: "Custom Model",
				modelType: "chat",
				contextWindow: 4096,
			})
		);

		await expect(
			tools.list_custom_models.execute({ provider: "openai" })
		).resolves.toEqual(
			expect.objectContaining({
				success: true,
				count: 1,
			})
		);
		expect(getCustomModels).toHaveBeenCalledWith("user-1", "db-1", "openai");
	});
});
