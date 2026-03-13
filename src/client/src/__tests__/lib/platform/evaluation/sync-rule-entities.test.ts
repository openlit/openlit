jest.mock("@/lib/platform/evaluation/config", () => ({
	getEvaluationConfig: jest.fn(),
}));

jest.mock("@/utils/asaw", () => jest.fn());

jest.mock("@/utils/json", () => ({
	jsonParse: jest.fn(),
	jsonStringify: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
	__esModule: true,
	default: {
		evaluationConfigs: {
			update: jest.fn(),
		},
	},
}));

jest.mock("@/lib/platform/rule-engine", () => ({
	addRuleEntity: jest.fn(),
	deleteRuleEntity: jest.fn(),
	getRuleEntities: jest.fn(),
}));

import { getEvaluationConfig } from "@/lib/platform/evaluation/config";
import asaw from "@/utils/asaw";
import { jsonParse, jsonStringify } from "@/utils/json";
import prisma from "@/lib/prisma";
import {
	addRuleEntity,
	deleteRuleEntity,
	getRuleEntities,
} from "@/lib/platform/rule-engine";
import {
	addRuleToEvaluationType,
	removeRuleFromEvaluationType,
	syncRuleEntitiesFromConfig,
} from "@/lib/platform/evaluation/sync-rule-entities";

const mockAsaw = asaw as jest.MockedFunction<typeof asaw>;
const mockGetEvaluationConfig = getEvaluationConfig as jest.MockedFunction<
	typeof getEvaluationConfig
>;
const mockJsonParse = jsonParse as jest.MockedFunction<typeof jsonParse>;
const mockJsonStringify = jsonStringify as jest.MockedFunction<
	typeof jsonStringify
>;
const mockPrismaUpdate = prisma.evaluationConfigs.update as jest.MockedFunction<
	typeof prisma.evaluationConfigs.update
>;
const mockAddRuleEntity = addRuleEntity as jest.MockedFunction<
	typeof addRuleEntity
>;
const mockDeleteRuleEntity = deleteRuleEntity as jest.MockedFunction<
	typeof deleteRuleEntity
>;
const mockGetRuleEntities = getRuleEntities as jest.MockedFunction<
	typeof getRuleEntities
>;

describe("addRuleToEvaluationType", () => {
	beforeEach(() => {
		jest.resetAllMocks();
		mockJsonStringify.mockReturnValue("{}");
		mockPrismaUpdate.mockResolvedValue({} as any);
	});

	it("returns early when asaw returns an error", async () => {
		mockAsaw.mockResolvedValueOnce([new Error("db error"), null]);

		await addRuleToEvaluationType("rule-1", "type-1");

		expect(mockPrismaUpdate).not.toHaveBeenCalled();
	});

	it("returns early when config has no id", async () => {
		mockAsaw.mockResolvedValueOnce([null, { meta: "{}" }]);

		await addRuleToEvaluationType("rule-1", "type-1");

		expect(mockPrismaUpdate).not.toHaveBeenCalled();
	});

	it("returns early when err is null but config is null", async () => {
		mockAsaw.mockResolvedValueOnce([null, null]);

		await addRuleToEvaluationType("rule-1", "type-1");

		expect(mockPrismaUpdate).not.toHaveBeenCalled();
	});

	it("returns early when evalTypeId is not found in meta evaluationTypes", async () => {
		const config = { id: "cfg-1", meta: '{"evaluationTypes":[]}' };
		mockAsaw.mockResolvedValueOnce([null, config]);
		mockJsonParse.mockReturnValue({
			evaluationTypes: [{ id: "other-type", rules: [] }],
		});

		await addRuleToEvaluationType("rule-1", "type-not-found");

		expect(mockPrismaUpdate).not.toHaveBeenCalled();
	});

	it("returns early when rule already exists in the type", async () => {
		const config = { id: "cfg-1", meta: '{}' };
		mockAsaw.mockResolvedValueOnce([null, config]);
		mockJsonParse.mockReturnValue({
			evaluationTypes: [
				{
					id: "type-1",
					rules: [{ ruleId: "rule-1", priority: 0 }],
				},
			],
		});

		await addRuleToEvaluationType("rule-1", "type-1");

		expect(mockPrismaUpdate).not.toHaveBeenCalled();
	});

	it("pushes new rule with default priority 0 and updates prisma", async () => {
		const config = { id: "cfg-1", meta: '{}' };
		mockAsaw.mockResolvedValueOnce([null, config]);
		mockJsonParse.mockReturnValue({
			evaluationTypes: [{ id: "type-1", rules: [] }],
		});
		mockJsonStringify.mockReturnValue('{"evaluationTypes":[{"id":"type-1","rules":[{"ruleId":"rule-1","priority":0}]}]}');

		await addRuleToEvaluationType("rule-1", "type-1");

		expect(mockJsonStringify).toHaveBeenCalledWith(
			expect.objectContaining({
				evaluationTypes: expect.arrayContaining([
					expect.objectContaining({
						id: "type-1",
						rules: expect.arrayContaining([
							{ ruleId: "rule-1", priority: 0 },
						]),
					}),
				]),
			})
		);
		expect(mockPrismaUpdate).toHaveBeenCalledWith({
			where: { id: "cfg-1" },
			data: { meta: expect.any(String) },
		});
	});

	it("pushes new rule with custom priority and updates prisma", async () => {
		const config = { id: "cfg-1", meta: '{}' };
		mockAsaw.mockResolvedValueOnce([null, config]);
		mockJsonParse.mockReturnValue({
			evaluationTypes: [{ id: "type-1", rules: [] }],
		});
		mockJsonStringify.mockReturnValue("serialized");

		await addRuleToEvaluationType("rule-1", "type-1", 5);

		expect(mockJsonStringify).toHaveBeenCalledWith(
			expect.objectContaining({
				evaluationTypes: expect.arrayContaining([
					expect.objectContaining({
						rules: expect.arrayContaining([
							{ ruleId: "rule-1", priority: 5 },
						]),
					}),
				]),
			})
		);
		expect(mockPrismaUpdate).toHaveBeenCalledWith({
			where: { id: "cfg-1" },
			data: { meta: "serialized" },
		});
	});

	it("adds to existing rules without removing them", async () => {
		const config = { id: "cfg-1", meta: '{}' };
		mockAsaw.mockResolvedValueOnce([null, config]);
		mockJsonParse.mockReturnValue({
			evaluationTypes: [
				{
					id: "type-1",
					rules: [{ ruleId: "existing-rule", priority: 1 }],
				},
			],
		});
		mockJsonStringify.mockReturnValue("serialized");

		await addRuleToEvaluationType("rule-2", "type-1");

		expect(mockJsonStringify).toHaveBeenCalledWith(
			expect.objectContaining({
				evaluationTypes: expect.arrayContaining([
					expect.objectContaining({
						rules: expect.arrayContaining([
							{ ruleId: "existing-rule", priority: 1 },
							{ ruleId: "rule-2", priority: 0 },
						]),
					}),
				]),
			})
		);
	});

	it("handles type with no rules property", async () => {
		const config = { id: "cfg-1", meta: '{}' };
		mockAsaw.mockResolvedValueOnce([null, config]);
		mockJsonParse.mockReturnValue({
			evaluationTypes: [{ id: "type-1" }],
		});
		mockJsonStringify.mockReturnValue("serialized");

		await addRuleToEvaluationType("rule-1", "type-1");

		expect(mockPrismaUpdate).toHaveBeenCalled();
	});

	it("handles empty meta string by defaulting to empty object", async () => {
		const config = { id: "cfg-1", meta: "" };
		mockAsaw.mockResolvedValueOnce([null, config]);
		mockJsonParse.mockReturnValue({
			evaluationTypes: [{ id: "type-1", rules: [] }],
		});
		mockJsonStringify.mockReturnValue("serialized");

		await addRuleToEvaluationType("rule-1", "type-1");

		expect(mockJsonParse).toHaveBeenCalledWith("{}");
	});
});

describe("removeRuleFromEvaluationType", () => {
	beforeEach(() => {
		jest.resetAllMocks();
		mockJsonStringify.mockReturnValue("{}");
		mockPrismaUpdate.mockResolvedValue({} as any);
	});

	it("returns early when asaw returns an error", async () => {
		mockAsaw.mockResolvedValueOnce([new Error("db error"), null]);

		await removeRuleFromEvaluationType("rule-1", "type-1");

		expect(mockPrismaUpdate).not.toHaveBeenCalled();
	});

	it("returns early when config has no id", async () => {
		mockAsaw.mockResolvedValueOnce([null, { meta: "{}" }]);

		await removeRuleFromEvaluationType("rule-1", "type-1");

		expect(mockPrismaUpdate).not.toHaveBeenCalled();
	});

	it("returns early when config is null", async () => {
		mockAsaw.mockResolvedValueOnce([null, null]);

		await removeRuleFromEvaluationType("rule-1", "type-1");

		expect(mockPrismaUpdate).not.toHaveBeenCalled();
	});

	it("returns early when evalTypeId is not found", async () => {
		const config = { id: "cfg-1", meta: '{}' };
		mockAsaw.mockResolvedValueOnce([null, config]);
		mockJsonParse.mockReturnValue({
			evaluationTypes: [{ id: "other-type", rules: [] }],
		});

		await removeRuleFromEvaluationType("rule-1", "type-not-found");

		expect(mockPrismaUpdate).not.toHaveBeenCalled();
	});

	it("filters out the specified rule and updates prisma", async () => {
		const config = { id: "cfg-1", meta: '{}' };
		mockAsaw.mockResolvedValueOnce([null, config]);
		mockJsonParse.mockReturnValue({
			evaluationTypes: [
				{
					id: "type-1",
					rules: [
						{ ruleId: "rule-1", priority: 0 },
						{ ruleId: "rule-2", priority: 1 },
					],
				},
			],
		});
		mockJsonStringify.mockReturnValue("serialized");

		await removeRuleFromEvaluationType("rule-1", "type-1");

		expect(mockJsonStringify).toHaveBeenCalledWith(
			expect.objectContaining({
				evaluationTypes: expect.arrayContaining([
					expect.objectContaining({
						id: "type-1",
						rules: [{ ruleId: "rule-2", priority: 1 }],
					}),
				]),
			})
		);
		expect(mockPrismaUpdate).toHaveBeenCalledWith({
			where: { id: "cfg-1" },
			data: { meta: "serialized" },
		});
	});

	it("results in empty rules array when removing the only rule", async () => {
		const config = { id: "cfg-1", meta: '{}' };
		mockAsaw.mockResolvedValueOnce([null, config]);
		mockJsonParse.mockReturnValue({
			evaluationTypes: [
				{
					id: "type-1",
					rules: [{ ruleId: "rule-1", priority: 0 }],
				},
			],
		});
		mockJsonStringify.mockReturnValue("serialized");

		await removeRuleFromEvaluationType("rule-1", "type-1");

		expect(mockJsonStringify).toHaveBeenCalledWith(
			expect.objectContaining({
				evaluationTypes: expect.arrayContaining([
					expect.objectContaining({
						id: "type-1",
						rules: [],
					}),
				]),
			})
		);
		expect(mockPrismaUpdate).toHaveBeenCalled();
	});

	it("is a no-op when rule is not in the type's rules list", async () => {
		const config = { id: "cfg-1", meta: '{}' };
		mockAsaw.mockResolvedValueOnce([null, config]);
		mockJsonParse.mockReturnValue({
			evaluationTypes: [
				{
					id: "type-1",
					rules: [{ ruleId: "other-rule", priority: 0 }],
				},
			],
		});
		mockJsonStringify.mockReturnValue("serialized");

		await removeRuleFromEvaluationType("rule-not-present", "type-1");

		expect(mockJsonStringify).toHaveBeenCalledWith(
			expect.objectContaining({
				evaluationTypes: expect.arrayContaining([
					expect.objectContaining({
						rules: [{ ruleId: "other-rule", priority: 0 }],
					}),
				]),
			})
		);
		expect(mockPrismaUpdate).toHaveBeenCalled();
	});

	it("handles type with no rules property", async () => {
		const config = { id: "cfg-1", meta: '{}' };
		mockAsaw.mockResolvedValueOnce([null, config]);
		mockJsonParse.mockReturnValue({
			evaluationTypes: [{ id: "type-1" }],
		});
		mockJsonStringify.mockReturnValue("serialized");

		await removeRuleFromEvaluationType("rule-1", "type-1");

		expect(mockPrismaUpdate).toHaveBeenCalled();
	});
});

describe("syncRuleEntitiesFromConfig", () => {
	beforeEach(() => {
		jest.resetAllMocks();
		mockPrismaUpdate.mockResolvedValue({} as any);
		mockDeleteRuleEntity.mockResolvedValue(undefined as any);
		mockAddRuleEntity.mockResolvedValue({} as any);
	});

	it("returns early when asaw returns an error for getEvaluationConfig", async () => {
		mockAsaw.mockResolvedValueOnce([new Error("db error"), null]);

		await syncRuleEntitiesFromConfig();

		expect(mockGetRuleEntities).not.toHaveBeenCalled();
	});

	it("returns early when config has no id", async () => {
		mockAsaw.mockResolvedValueOnce([null, { meta: "{}" }]);

		await syncRuleEntitiesFromConfig();

		expect(mockGetRuleEntities).not.toHaveBeenCalled();
	});

	it("returns early when config is null", async () => {
		mockAsaw.mockResolvedValueOnce([null, null]);

		await syncRuleEntitiesFromConfig();

		expect(mockGetRuleEntities).not.toHaveBeenCalled();
	});

	it("returns early when getRuleEntities returns an error", async () => {
		const config = { id: "cfg-1", meta: '{}' };
		mockAsaw.mockResolvedValueOnce([null, config]);
		mockJsonParse.mockReturnValue({ evaluationTypes: [] });
		mockGetRuleEntities.mockResolvedValue({ err: new Error("ch error"), data: undefined } as any);

		await syncRuleEntitiesFromConfig();

		expect(mockDeleteRuleEntity).not.toHaveBeenCalled();
		expect(mockAddRuleEntity).not.toHaveBeenCalled();
	});

	it("returns early when getRuleEntities returns no data", async () => {
		const config = { id: "cfg-1", meta: '{}' };
		mockAsaw.mockResolvedValueOnce([null, config]);
		mockJsonParse.mockReturnValue({ evaluationTypes: [] });
		mockGetRuleEntities.mockResolvedValue({ err: undefined, data: undefined } as any);

		await syncRuleEntitiesFromConfig();

		expect(mockDeleteRuleEntity).not.toHaveBeenCalled();
		expect(mockAddRuleEntity).not.toHaveBeenCalled();
	});

	it("calls getRuleEntities with entity_type evaluation", async () => {
		const config = { id: "cfg-1", meta: '{}' };
		mockAsaw.mockResolvedValueOnce([null, config]);
		mockJsonParse.mockReturnValue({ evaluationTypes: [] });
		mockGetRuleEntities.mockResolvedValue({ err: undefined, data: [] } as any);

		await syncRuleEntitiesFromConfig();

		expect(mockGetRuleEntities).toHaveBeenCalledWith({ entity_type: "evaluation" });
	});

	it("deletes entities that are not in the desired set", async () => {
		const config = { id: "cfg-1", meta: '{}' };
		mockAsaw.mockResolvedValueOnce([null, config]);
		mockJsonParse.mockReturnValue({
			evaluationTypes: [
				{ id: "type-1", rules: [{ ruleId: "rule-1", priority: 0 }] },
			],
		});
		const entities = [
			{ id: "entity-stale", rule_id: "rule-stale", entity_id: "type-1" },
			{ id: "entity-valid", rule_id: "rule-1", entity_id: "type-1" },
		];
		mockGetRuleEntities.mockResolvedValue({ err: undefined, data: entities } as any);
		mockAsaw.mockResolvedValue([null, {}]);

		await syncRuleEntitiesFromConfig();

		expect(mockDeleteRuleEntity).toHaveBeenCalledWith("entity-stale");
		expect(mockDeleteRuleEntity).not.toHaveBeenCalledWith("entity-valid");
	});

	it("deletes entities whose type is not in config", async () => {
		const config = { id: "cfg-1", meta: '{}' };
		mockAsaw.mockResolvedValueOnce([null, config]);
		mockJsonParse.mockReturnValue({
			evaluationTypes: [],
		});
		const entities = [
			{ id: "entity-1", rule_id: "rule-1", entity_id: "type-1" },
		];
		mockGetRuleEntities.mockResolvedValue({ err: undefined, data: entities } as any);
		mockAsaw.mockResolvedValue([null, {}]);

		await syncRuleEntitiesFromConfig();

		expect(mockDeleteRuleEntity).toHaveBeenCalledWith("entity-1");
	});

	it("adds rule entities that are missing from ClickHouse", async () => {
		const config = { id: "cfg-1", meta: '{}' };
		mockAsaw.mockResolvedValueOnce([null, config]);
		mockJsonParse.mockReturnValue({
			evaluationTypes: [
				{ id: "type-1", rules: [{ ruleId: "rule-1", priority: 0 }] },
			],
		});
		mockGetRuleEntities.mockResolvedValue({ err: undefined, data: [] } as any);
		mockAsaw.mockResolvedValue([null, {}]);

		await syncRuleEntitiesFromConfig();

		expect(mockAddRuleEntity).toHaveBeenCalledWith({
			rule_id: "rule-1",
			entity_type: "evaluation",
			entity_id: "type-1",
		});
	});

	it("does not add rule entities that already exist", async () => {
		const config = { id: "cfg-1", meta: '{}' };
		mockAsaw.mockResolvedValueOnce([null, config]);
		mockJsonParse.mockReturnValue({
			evaluationTypes: [
				{ id: "type-1", rules: [{ ruleId: "rule-1", priority: 0 }] },
			],
		});
		const entities = [
			{ id: "entity-1", rule_id: "rule-1", entity_id: "type-1" },
		];
		mockGetRuleEntities.mockResolvedValue({ err: undefined, data: entities } as any);
		mockAsaw.mockResolvedValue([null, {}]);

		await syncRuleEntitiesFromConfig();

		expect(mockAddRuleEntity).not.toHaveBeenCalled();
	});

	it("handles addRuleEntity errors gracefully and continues", async () => {
		const config = { id: "cfg-1", meta: '{}' };
		mockAsaw.mockResolvedValueOnce([null, config]);
		mockJsonParse.mockReturnValue({
			evaluationTypes: [
				{
					id: "type-1",
					rules: [
						{ ruleId: "rule-1", priority: 0 },
						{ ruleId: "rule-2", priority: 1 },
					],
				},
			],
		});
		mockGetRuleEntities.mockResolvedValue({ err: undefined, data: [] } as any);
		mockAsaw
			.mockResolvedValueOnce([new Error("add failed"), null])
			.mockResolvedValueOnce([null, {}]);

		const consoleSpy = jest
			.spyOn(console, "error")
			.mockImplementation(() => {});

		await syncRuleEntitiesFromConfig();

		expect(consoleSpy).toHaveBeenCalledWith(
			"Failed to add rule entity:",
			expect.any(Error)
		);
		expect(mockAddRuleEntity).toHaveBeenCalledTimes(2);

		consoleSpy.mockRestore();
	});

	it("skips rules with empty ruleId", async () => {
		const config = { id: "cfg-1", meta: '{}' };
		mockAsaw.mockResolvedValueOnce([null, config]);
		mockJsonParse.mockReturnValue({
			evaluationTypes: [
				{
					id: "type-1",
					rules: [
						{ ruleId: "", priority: 0 },
						{ ruleId: "rule-valid", priority: 1 },
					],
				},
			],
		});
		mockGetRuleEntities.mockResolvedValue({ err: undefined, data: [] } as any);
		mockAsaw.mockResolvedValue([null, {}]);

		await syncRuleEntitiesFromConfig();

		expect(mockAddRuleEntity).toHaveBeenCalledTimes(1);
		expect(mockAddRuleEntity).toHaveBeenCalledWith(
			expect.objectContaining({ rule_id: "rule-valid" })
		);
	});

	it("handles types with no rules property", async () => {
		const config = { id: "cfg-1", meta: '{}' };
		mockAsaw.mockResolvedValueOnce([null, config]);
		mockJsonParse.mockReturnValue({
			evaluationTypes: [{ id: "type-1" }],
		});
		mockGetRuleEntities.mockResolvedValue({ err: undefined, data: [] } as any);

		await syncRuleEntitiesFromConfig();

		expect(mockDeleteRuleEntity).not.toHaveBeenCalled();
		expect(mockAddRuleEntity).not.toHaveBeenCalled();
	});

	it("handles multiple types and multiple rules correctly", async () => {
		const config = { id: "cfg-1", meta: '{}' };
		mockAsaw.mockResolvedValueOnce([null, config]);
		mockJsonParse.mockReturnValue({
			evaluationTypes: [
				{
					id: "type-1",
					rules: [
						{ ruleId: "rule-a", priority: 0 },
						{ ruleId: "rule-b", priority: 1 },
					],
				},
				{
					id: "type-2",
					rules: [{ ruleId: "rule-a", priority: 0 }],
				},
			],
		});
		const entities = [
			{ id: "e1", rule_id: "rule-a", entity_id: "type-1" },
			{ id: "e2", rule_id: "rule-c", entity_id: "type-1" },
		];
		mockGetRuleEntities.mockResolvedValue({ err: undefined, data: entities } as any);
		mockAsaw.mockResolvedValue([null, {}]);

		await syncRuleEntitiesFromConfig();

		expect(mockDeleteRuleEntity).toHaveBeenCalledWith("e2");
		expect(mockDeleteRuleEntity).not.toHaveBeenCalledWith("e1");
		expect(mockAddRuleEntity).toHaveBeenCalledWith(
			expect.objectContaining({ rule_id: "rule-b", entity_id: "type-1" })
		);
		expect(mockAddRuleEntity).toHaveBeenCalledWith(
			expect.objectContaining({ rule_id: "rule-a", entity_id: "type-2" })
		);
		expect(mockAddRuleEntity).not.toHaveBeenCalledWith(
			expect.objectContaining({ rule_id: "rule-a", entity_id: "type-1" })
		);
	});
});
