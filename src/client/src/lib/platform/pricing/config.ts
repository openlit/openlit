import getMessage from "@/constants/messages";
import { getDBConfigByUser } from "@/lib/db-config";
import prisma from "@/lib/prisma";
import asaw from "@/utils/asaw";
import { throwIfError } from "@/utils/error";
import { DatabaseConfig } from "@/types/database-config";
import Cron from "@/helpers/server/cron";
import { jsonParse, jsonStringify } from "@/utils/json";
import { merge } from "lodash";
import { randomUUID } from "crypto";
import path from "path";

export interface PricingConfig {
	id: string;
	databaseConfigId: string;
	auto: boolean;
	recurringTime: string;
	meta: string;
}

export interface PricingConfigInput {
	id?: string;
	auto: boolean;
	recurringTime: string;
	meta: string;
}

/**
 * Get the pricing config for the current user's database.
 * Returns an empty shell (no id) if nothing exists yet — pricing is optional.
 */
export async function getPricingConfig(
	dbConfig?: DatabaseConfig
): Promise<PricingConfig | null> {
	let updatedDBConfig: DatabaseConfig | undefined = dbConfig;
	if (!dbConfig?.id) {
		[, updatedDBConfig] = await asaw(getDBConfigByUser(true));
	}

	if (!updatedDBConfig?.id) return null;

	const [, config] = await asaw(
		prisma.pricingConfigs.findFirst({
			where: { databaseConfigId: updatedDBConfig.id },
		})
	);

	return (config as PricingConfig) || null;
}

export async function getPricingConfigById(
	id: string
): Promise<PricingConfig | null> {
	const [, config] = await asaw(
		prisma.pricingConfigs.findFirst({ where: { id } })
	);
	return (config as PricingConfig) || null;
}

/**
 * Create or update pricing config, and wire up cron if auto is enabled.
 */
export async function setPricingConfig(
	pricingConfig: PricingConfigInput,
	apiURL: string
) {
	const [, dbConfig] = await asaw(getDBConfigByUser(true));
	throwIfError(!dbConfig?.id, getMessage().DATABASE_CONFIG_NOT_FOUND);

	const cronObject = new Cron();
	if (pricingConfig.auto) {
		cronObject.validateCronSchedule(pricingConfig.recurringTime);
	}

	let previousConfig: PricingConfig | null = null;
	let cronJobId: string | undefined;
	let pricingConfigId: string | undefined;
	let data: any;
	let err: any;

	if (pricingConfig.id) {
		previousConfig = await getPricingConfigById(pricingConfig.id);
		pricingConfigId = previousConfig?.id;
		const meta = jsonParse(previousConfig?.meta || "{}") as Record<string, any>;
		cronJobId = meta?.cronJobId || randomUUID();
		pricingConfig.meta = jsonStringify({ ...meta, cronJobId });
		pricingConfig = merge(previousConfig || {}, pricingConfig) as PricingConfigInput;
		[err, data] = await asaw(
			prisma.pricingConfigs.update({
				data: {
					auto: pricingConfig.auto,
					recurringTime: pricingConfig.recurringTime,
					meta: pricingConfig.meta,
				},
				where: { id: pricingConfig.id },
			})
		);
	} else {
		cronJobId = randomUUID();
		const meta = jsonParse(pricingConfig.meta || "{}") as Record<string, any>;
		pricingConfig.meta = jsonStringify({ ...meta, cronJobId });
		[err, data] = await asaw(
			prisma.pricingConfigs.create({
				data: {
					auto: pricingConfig.auto,
					recurringTime: pricingConfig.recurringTime,
					meta: pricingConfig.meta,
					databaseConfigId: dbConfig.id,
				},
			})
		);
		pricingConfigId = data?.id;
	}

	throwIfError(err, getMessage().OPERATION_FAILED);

	try {
		if (pricingConfig.auto) {
			await cronObject.updateCrontab({
				cronId: cronJobId!,
				cronSchedule: pricingConfig.recurringTime,
				cronEnvVars: {
					PRICING_CONFIG_ID: pricingConfigId!,
					API_URL: apiURL,
				},
				cronScriptPath: path.join(process.cwd(), "scripts/pricing/auto.js"),
				cronLogPath: path.join(process.cwd(), "logs/pricing/auto.log"),
			});
		} else {
			await cronObject.deleteCronJob(cronJobId!);
		}
	} catch (error) {
		console.error(getMessage().CRON_JOB_UPDATION_ERROR, error);
		throw error;
	}

	return data;
}

/**
 * Restore cron jobs for pricing configs with auto=true on startup.
 */
export async function restorePricingCronJobs(apiURL: string) {
	try {
		const configs = await prisma.pricingConfigs.findMany({
			where: { auto: true },
		});

		if (!configs?.length) {
			console.log("No auto-pricing configs to restore");
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
						PRICING_CONFIG_ID: config.id,
						API_URL: apiURL,
					},
					cronScriptPath: path.join(process.cwd(), "scripts/pricing/auto.js"),
					cronLogPath: path.join(process.cwd(), "logs/pricing/auto.log"),
				});
				console.log(`Restored cron job for pricing config ${config.id}`);
			} catch (e) {
				console.error(`Failed to restore cron job for pricing config ${config.id}:`, e);
			}
		}
	} catch (e) {
		console.error("Failed to restore pricing cron jobs:", e);
	}
}
