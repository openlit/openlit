import getMessage from "@/constants/messages";
import { getDBConfigByUser } from "@/lib/db-config";
import prisma from "@/lib/prisma";
import asaw from "@/utils/asaw";
import { throwIfError } from "@/utils/error";
import { getSecretById } from "../vault";
import { Secret } from "@/types/vault";
import {
	EvaluationConfig,
	EvaluationConfigInput,
	EvaluationConfigWithSecret,
} from "@/types/evaluation";
import { DatabaseConfig } from "@/types/database-config";
import Cron from "@/helpers/server/cron";
import { jsonParse, jsonStringify } from "@/utils/json";
import { merge } from "lodash";
import { randomUUID } from "crypto";
import path, { dirname } from "path";
import { EVALUATION_TYPES } from "@/constants/evaluation-types";
import { getEvaluationTypeDefaultPrompts } from "./evaluation-type-defaults";

export interface EvaluationTypeWithPrompt {
	id: string;
	label: string;
	description: string;
	enabledByDefault: boolean;
	enabled: boolean;
	rules?: Array<{ ruleId: string; priority: number }>;
	prompt?: string;
	defaultPrompt: string;
}

async function buildEvaluationTypesWithPrompts(
	meta: Record<string, any>
): Promise<EvaluationTypeWithPrompt[]> {
	const defaultPrompts = await getEvaluationTypeDefaultPrompts();
	const userOverrides = (meta.evaluationTypes as Array<{
		id: string;
		enabled?: boolean;
		rules?: Array<{ ruleId: string; priority: number }>;
		prompt?: string;
	}>) || [];

	const overrideMap = new Map(
		userOverrides.filter((t) => t?.id).map((t) => [t.id, t])
	);

	return EVALUATION_TYPES.map((et) => {
		const override = overrideMap.get(et.id);
		return {
			id: et.id,
			label: et.label,
			description: et.description,
			enabledByDefault: et.enabledByDefault,
			enabled: override?.enabled ?? et.enabledByDefault,
			rules: override?.rules?.filter((r) => r?.ruleId) ?? [],
			prompt: override?.prompt,
			defaultPrompt: defaultPrompts[et.id] ?? "",
		};
	});
}

export async function getEvaluationConfig(
	dbConfig?: DatabaseConfig,
	excludeVaultValue: boolean = true,
	validateVaultId: boolean = true,
): Promise<EvaluationConfigWithSecret & { evaluationTypes?: EvaluationTypeWithPrompt[] }> {
	let updatedDBConfig: DatabaseConfig | undefined = dbConfig;
	if (!dbConfig?.id) {
		[, updatedDBConfig] = await asaw(getDBConfigByUser(true));
	}

	const [, config] = await asaw(
		prisma.evaluationConfigs.findFirst({
			where: {
				databaseConfigId: updatedDBConfig!.id,
			},
		})
	);

	const updatedConfig = config as EvaluationConfig;
	throwIfError(!updatedConfig?.id, getMessage().EVALUATION_CONFIG_NOT_FOUND);

	const { data } = await getSecretById(
		updatedConfig.vaultId,
		updatedDBConfig!.id,
		excludeVaultValue
	);

	const updatedSecretData = (data as Secret[])?.[0] || {};

	if (validateVaultId) {
		throwIfError(
			!updatedSecretData?.id,
			getMessage().EVALUATION_VAULT_SECRET_NOT_FOUND
		);
	} else {
		if (!updatedSecretData.id) {
			updatedConfig.vaultId = "";
		}
	}

	const meta = jsonParse((updatedConfig as any).meta || "{}") as Record<string, any>;
	const evaluationTypes = await buildEvaluationTypesWithPrompts(meta);

	return {
		...updatedConfig,
		secret: updatedSecretData,
		evaluationTypes,
	};
}

export async function setEvaluationConfig(
	evaluationConfig: EvaluationConfigInput,
	apiURL: string
) {
	const [, dbConfig] = await asaw(getDBConfigByUser(true));

	throwIfError(!dbConfig?.id, getMessage().DATABASE_CONFIG_NOT_FOUND);

	let err: any;
	let data: any;

	let previousConfig: EvaluationConfig | undefined;
	let cronJobId: string | undefined;
	let evaluationConfigId: string | undefined;

	const cronObject = new Cron();

	if (evaluationConfig.auto) {
		cronObject.validateCronSchedule(evaluationConfig.recurringTime);
	}

	if (evaluationConfig.id) {
		[, previousConfig] = await asaw(
			prisma.evaluationConfigs.findFirst({
				where: {
					id: evaluationConfig.id!,
				},
			})
		);

		evaluationConfigId = previousConfig?.id;
		const meta = jsonParse(previousConfig?.meta || "{}") as Record<string, any>;
		cronJobId = meta?.cronJobId || randomUUID();
		evaluationConfig.meta = jsonStringify({
			...meta,
			cronJobId,
		});
		evaluationConfig = merge(previousConfig, evaluationConfig);
		[err, data] = await asaw(
			prisma.evaluationConfigs.update({
				data: evaluationConfig,
				where: {
					id: evaluationConfig.id!,
				},
			})
		);
	} else {
		cronJobId = randomUUID();
		const meta = jsonParse(evaluationConfig.meta) as Record<string, any>;
		evaluationConfig.meta = jsonStringify({
			...meta,
			cronJobId,
		});
		[err, data] = await asaw(
			prisma.evaluationConfigs.create({
				data: {
					...evaluationConfig,
					databaseConfigId: dbConfig!.id,
				},
			})
		);
		evaluationConfigId = data?.id;
	}

	throwIfError(err, getMessage().EVALUATION_CONFIG_SET_ERROR);

	try {
		if (evaluationConfig.auto) {
			await new Cron().updateCrontab({
				cronId: cronJobId!,
				cronSchedule: evaluationConfig.recurringTime,
				cronEnvVars: {
					EVALUATION_CONFIG_ID: evaluationConfigId!,
					API_URL: apiURL,
				},
				cronScriptPath: path.join(process.cwd(), "scripts/evaluation/auto.js"),
				cronLogPath: path.join(process.cwd(), "logs/evaluation/auto.log"),
			});
		} else {
			await new Cron().deleteCronJob(cronJobId!);
		}
	} catch (error) {
		console.error(getMessage().CRON_JOB_UPDATION_ERROR, error);
		throw error;
	}

	return data;
}

/**
 * Restore cron jobs for all evaluation configs that have auto=true.
 * Called on server startup to ensure cron entries survive container restarts / new image deployments.
 */
export async function restoreEvaluationCronJobs(apiURL: string) {
	try {
		const configs = await prisma.evaluationConfigs.findMany({
			where: { auto: true },
		});

		if (!configs?.length) {
			console.log("No auto-evaluation configs to restore");
			return;
		}

		const cronObject = new Cron();

		for (const config of configs) {
			try {
				const meta = jsonParse(config.meta || "{}") as Record<string, any>;
				const cronJobId = meta?.cronJobId;
				if (!cronJobId || !config.recurringTime) continue;

				cronObject.updateCrontab({
					cronId: cronJobId,
					cronSchedule: config.recurringTime,
					cronEnvVars: {
						EVALUATION_CONFIG_ID: config.id,
						API_URL: apiURL,
					},
					cronScriptPath: path.join(process.cwd(), "scripts/evaluation/auto.js"),
					cronLogPath: path.join(process.cwd(), "logs/evaluation/auto.log"),
				});
				console.log(`Restored cron job for evaluation config ${config.id}`);
			} catch (e) {
				console.error(`Failed to restore cron job for config ${config.id}:`, e);
			}
		}
	} catch (e) {
		console.error("Failed to restore evaluation cron jobs:", e);
	}
}

export async function getEvaluationConfigById(
	id: string,
	excludeVaultValue: boolean = true
): Promise<EvaluationConfigWithSecret & { evaluationTypes?: EvaluationTypeWithPrompt[] }> {
	const [err, data] = await asaw(
		prisma.evaluationConfigs.findFirst({
			where: { id },
		})
	);

	const updatedConfig = data as EvaluationConfig;
	throwIfError(
		!updatedConfig?.id || err,
		getMessage().EVALUATION_CONFIG_NOT_FOUND
	);

	const { data: secretData } = await getSecretById(
		updatedConfig.vaultId,
		updatedConfig.databaseConfigId,
		excludeVaultValue
	);

	const updatedSecretData = (secretData as Secret[])?.[0] || {};

	const meta = jsonParse((updatedConfig as any).meta || "{}") as Record<string, any>;
	const evaluationTypes = await buildEvaluationTypesWithPrompts(meta);

	return {
		...updatedConfig,
		secret: updatedSecretData,
		evaluationTypes,
	};
}
