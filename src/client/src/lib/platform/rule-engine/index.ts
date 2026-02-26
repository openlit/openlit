import getMessage from "@/constants/messages";
import {
	RuleConditionGroupInput,
	RuleEntityInput,
	RuleInput,
} from "@/types/rule-engine";
import {
	verifyConditionGroupInput,
	verifyEntityInput,
	verifyRuleInput,
} from "@/helpers/server/rule-engine";
import { getCurrentUser } from "@/lib/session";
import { throwIfError } from "@/utils/error";
import Sanitizer from "@/utils/sanitizer";
import {
	OPENLIT_RULE_CONDITION_GROUPS_TABLE_NAME,
	OPENLIT_RULE_CONDITIONS_TABLE_NAME,
	OPENLIT_RULE_ENTITIES_TABLE_NAME,
	OPENLIT_RULES_TABLE_NAME,
} from "./table-details";
import { dataCollector } from "../common";

export async function getRules(databaseConfigId?: string) {
	const user = await getCurrentUser();
	throwIfError(!user, getMessage().UNAUTHORIZED_USER);

	const query = `
    SELECT * FROM ${OPENLIT_RULES_TABLE_NAME}
    ORDER BY created_at DESC;
  `;

	return await dataCollector({ query }, "query", databaseConfigId);
}

export async function getRuleById(id: string, databaseConfigId?: string) {
	const user = await getCurrentUser();
	throwIfError(!user, getMessage().UNAUTHORIZED_USER);

	const safeId = Sanitizer.sanitizeValue(id);

	const ruleQuery = `
    SELECT * FROM ${OPENLIT_RULES_TABLE_NAME}
    WHERE id = '${safeId}';
  `;

	const groupsQuery = `
    SELECT * FROM ${OPENLIT_RULE_CONDITION_GROUPS_TABLE_NAME}
    WHERE rule_id = '${safeId}'
    ORDER BY created_at ASC;
  `;

	const conditionsQuery = `
    SELECT * FROM ${OPENLIT_RULE_CONDITIONS_TABLE_NAME}
    WHERE rule_id = '${safeId}'
    ORDER BY created_at ASC;
  `;

	const [ruleResult, groupsResult, conditionsResult] = await Promise.all([
		dataCollector({ query: ruleQuery }, "query", databaseConfigId),
		dataCollector({ query: groupsQuery }, "query", databaseConfigId),
		dataCollector({ query: conditionsQuery }, "query", databaseConfigId),
	]);

	if (ruleResult.err) return ruleResult;

	const rule = (ruleResult.data as any[])?.[0];
	if (!rule) return { err: getMessage().RULE_NOT_FOUND };

	const groups = (groupsResult.data as any[]) || [];
	const conditions = (conditionsResult.data as any[]) || [];

	const groupsWithConditions = groups.map((group: any) => ({
		...group,
		conditions: conditions.filter((c: any) => c.group_id === group.id),
	}));

	return {
		data: { ...rule, condition_groups: groupsWithConditions },
	};
}

export async function createRule(ruleInputParams: Partial<RuleInput>) {
	const user = await getCurrentUser();
	throwIfError(!user, getMessage().UNAUTHORIZED_USER);

	const ruleInput = Sanitizer.sanitizeObject(ruleInputParams);
	const verified = verifyRuleInput(ruleInput);
	throwIfError(!verified.success, verified.err!);

	const ruleId = crypto.randomUUID();

	const insertQuery = `
    INSERT INTO ${OPENLIT_RULES_TABLE_NAME}
      (id, name, description, group_operator, status, created_by)
    VALUES
      ('${ruleId}', '${ruleInput.name}', '${ruleInput.description || ""}', '${ruleInput.group_operator || "AND"}', '${ruleInput.status || "ACTIVE"}', '${user!.email}');
  `;

	const { err } = await dataCollector({ query: insertQuery }, "exec");

	throwIfError(
		!!err,
		typeof err?.toString === "function" ? err.toString() : (err as string) || getMessage().RULE_NOT_CREATED
	);

	return { message: getMessage().RULE_CREATED, id: ruleId };
}

export async function updateRule(id: string, ruleInputParams: Partial<RuleInput>) {
	const user = await getCurrentUser();
	throwIfError(!user, getMessage().UNAUTHORIZED_USER);

	const ruleInput = Sanitizer.sanitizeObject(ruleInputParams);
	const verified = verifyRuleInput(ruleInput);
	throwIfError(!verified.success, verified.err!);

	const safeId = Sanitizer.sanitizeValue(id);

	const updateValues = [
		`updated_at = now()`,
		ruleInput.name && `name = '${ruleInput.name}'`,
		ruleInput.description !== undefined && `description = '${ruleInput.description}'`,
		ruleInput.group_operator && `group_operator = '${ruleInput.group_operator}'`,
		ruleInput.status && `status = '${ruleInput.status}'`,
	];

	const updateQuery = `
    ALTER TABLE ${OPENLIT_RULES_TABLE_NAME}
    UPDATE ${updateValues.filter(Boolean).join(", ")}
    WHERE id = '${safeId}'`;

	const { err, data } = await dataCollector({ query: updateQuery }, "exec");

	throwIfError(
		!!(err || !(data as { query_id: unknown })?.query_id),
		typeof err?.toString === "function"
			? err.toString()
			: (err as string) || getMessage().RULE_NOT_UPDATED
	);

	return { message: getMessage().RULE_UPDATED };
}

export async function deleteRule(id: string) {
	const user = await getCurrentUser();
	throwIfError(!user, getMessage().UNAUTHORIZED_USER);

	const safeId = Sanitizer.sanitizeValue(id);

	// Delete the rule and all related data
	const [ruleResult, groupsResult, conditionsResult, entitiesResult] = await Promise.all([
		dataCollector(
			{ query: `DELETE FROM ${OPENLIT_RULES_TABLE_NAME} WHERE id = '${safeId}';` },
			"exec"
		),
		dataCollector(
			{ query: `DELETE FROM ${OPENLIT_RULE_CONDITION_GROUPS_TABLE_NAME} WHERE rule_id = '${safeId}';` },
			"exec"
		),
		dataCollector(
			{ query: `DELETE FROM ${OPENLIT_RULE_CONDITIONS_TABLE_NAME} WHERE rule_id = '${safeId}';` },
			"exec"
		),
		dataCollector(
			{ query: `DELETE FROM ${OPENLIT_RULE_ENTITIES_TABLE_NAME} WHERE rule_id = '${safeId}';` },
			"exec"
		),
	]);

	if (ruleResult.err) {
		return [getMessage().RULE_NOT_DELETED];
	}

	return [undefined, getMessage().RULE_DELETED];
}

export async function addConditionGroupsToRule(
	ruleId: string,
	conditionGroups: RuleConditionGroupInput[]
) {
	const user = await getCurrentUser();
	throwIfError(!user, getMessage().UNAUTHORIZED_USER);

	const safeRuleId = Sanitizer.sanitizeValue(ruleId);

	for (const group of conditionGroups) {
		const verified = verifyConditionGroupInput(group);
		throwIfError(!verified.success, verified.err!);
	}

	// Delete existing condition groups and conditions before re-inserting
	await Promise.all([
		dataCollector(
			{ query: `DELETE FROM ${OPENLIT_RULE_CONDITION_GROUPS_TABLE_NAME} WHERE rule_id = '${safeRuleId}';` },
			"exec"
		),
		dataCollector(
			{ query: `DELETE FROM ${OPENLIT_RULE_CONDITIONS_TABLE_NAME} WHERE rule_id = '${safeRuleId}';` },
			"exec"
		),
	]);

	for (const group of conditionGroups) {
		const sanitizedGroup = Sanitizer.sanitizeObject(group);

		// Insert the group and get its ID via a query
		const groupId = crypto.randomUUID();

		const insertGroupQuery = `
      INSERT INTO ${OPENLIT_RULE_CONDITION_GROUPS_TABLE_NAME}
        (id, rule_id, condition_operator)
      VALUES
        ('${groupId}', '${safeRuleId}', '${sanitizedGroup.condition_operator || "AND"}');
    `;

		const { err: groupErr } = await dataCollector({ query: insertGroupQuery }, "exec");
		throwIfError(
			!!groupErr,
			typeof groupErr?.toString === "function"
				? groupErr.toString()
				: (groupErr as string) || getMessage().RULE_CONDITION_GROUP_NOT_ADDED
		);

		// Insert all conditions for this group
		const conditions = sanitizedGroup.conditions || [];
		if (conditions.length > 0) {
			const conditionValues = conditions
				.map((c: any) => {
					const condId = crypto.randomUUID();
					return `('${condId}', '${safeRuleId}', '${groupId}', '${c.field}', '${c.operator}', '${c.value}', '${c.data_type || "string"}')`;
				})
				.join(",\n");

			const insertConditionsQuery = `
        INSERT INTO ${OPENLIT_RULE_CONDITIONS_TABLE_NAME}
          (id, rule_id, group_id, field, operator, value, data_type)
        VALUES
          ${conditionValues};
      `;

			const { err: condErr } = await dataCollector({ query: insertConditionsQuery }, "exec");
			throwIfError(
				!!condErr,
				typeof condErr?.toString === "function"
					? condErr.toString()
					: (condErr as string) || getMessage().RULE_CONDITION_GROUP_NOT_ADDED
			);
		}
	}

	return { message: getMessage().RULE_CONDITION_GROUP_ADDED };
}

export async function addRuleEntity(entityInputParams: Partial<RuleEntityInput>) {
	const user = await getCurrentUser();
	throwIfError(!user, getMessage().UNAUTHORIZED_USER);

	const entityInput = Sanitizer.sanitizeObject(entityInputParams);
	const verified = verifyEntityInput(entityInput);
	throwIfError(!verified.success, verified.err!);

	const { err } = await dataCollector(
		{
			table: OPENLIT_RULE_ENTITIES_TABLE_NAME,
			values: [
				{
					rule_id: entityInput.rule_id,
					entity_type: entityInput.entity_type,
					entity_id: entityInput.entity_id,
					created_by: user!.email,
				},
			],
		},
		"insert"
	);

	throwIfError(
		!!err,
		typeof err?.toString === "function"
			? err.toString()
			: (err as string) || getMessage().RULE_ENTITY_NOT_ASSOCIATED
	);

	return { message: getMessage().RULE_ENTITY_ASSOCIATED };
}

export async function deleteRuleEntity(id: string) {
	const user = await getCurrentUser();
	throwIfError(!user, getMessage().UNAUTHORIZED_USER);

	const safeId = Sanitizer.sanitizeValue(id);

	const { err } = await dataCollector(
		{ query: `DELETE FROM ${OPENLIT_RULE_ENTITIES_TABLE_NAME} WHERE id = '${safeId}';` },
		"exec"
	);

	if (err) {
		return [getMessage().RULE_ENTITY_NOT_DELETED];
	}

	return [undefined, getMessage().RULE_ENTITY_DELETED];
}

export async function getRuleEntities(filters: { rule_id?: string; entity_type?: string } = {}) {
	const user = await getCurrentUser();
	throwIfError(!user, getMessage().UNAUTHORIZED_USER);

	const conditions: string[] = [];
	if (filters.rule_id) {
		conditions.push(`rule_id = '${Sanitizer.sanitizeValue(filters.rule_id)}'`);
	}
	if (filters.entity_type) {
		conditions.push(`entity_type = '${Sanitizer.sanitizeValue(filters.entity_type)}'`);
	}

	const query = `
    SELECT * FROM ${OPENLIT_RULE_ENTITIES_TABLE_NAME}
    ${conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""}
    ORDER BY created_at DESC;
  `;

	return await dataCollector({ query }, "query");
}
