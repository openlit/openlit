import crypto from "crypto";
import { getDBConfigByUser } from "@/lib/db-config";
import asaw from "@/utils/asaw";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { throwIfError } from "@/utils/error";
import getMessage from "@/constants/messages";
import { recordOrganisationUsageEvent } from "@/lib/billing/usage-recorder";
import { getCurrentOrganisation } from "@/lib/organisation";

const APIKEY_PREFIX = "openlit-";

function previewApiKey(apiKey: string): string {
	const body = apiKey.startsWith(APIKEY_PREFIX)
		? apiKey.slice(APIKEY_PREFIX.length)
		: apiKey;
	return `${APIKEY_PREFIX}${body.slice(0, 4)}…${body.slice(-6)}`;
}

export interface APIKeyInfo {
	id: string;
	databaseConfigId: string | null;
	organisationId?: string | null;
	projectId?: string | null;
	environment?: string;
	createdByUser?: { email: string } | null;
	createdByUserId?: string;
}

const DEFAULT_API_KEY_ENVIRONMENT = "production";

function scopeFromKeyRow(row: {
	organisationId?: string | null;
	projectId?: string | null;
	environment?: string | null;
	databaseConfig?: {
		projectId?: string | null;
		environment?: string | null;
		project?: { organisationId?: string | null } | null;
	} | null;
}): Pick<APIKeyInfo, "organisationId" | "projectId" | "environment"> {
	return {
		organisationId:
			row.organisationId || row.databaseConfig?.project?.organisationId || null,
		projectId: row.projectId || row.databaseConfig?.projectId || null,
		environment:
			row.environment ||
			row.databaseConfig?.environment ||
			DEFAULT_API_KEY_ENVIRONMENT,
	};
}

function createAPIKey() {
	// Generate 32 random bytes
	const key = crypto.randomBytes(32);

	// Convert the byte array to a Base64 string
	return `${APIKEY_PREFIX}${key.toString("base64")}`;
}

export async function generateAPIKey(name: string) {
	const user = await getCurrentUser();

	throwIfError(!user, getMessage().UNAUTHORIZED_USER);

	const [err, dbConfig] = await asaw(getDBConfigByUser(true));

	throwIfError(err, err);
	throwIfError(!dbConfig?.id, getMessage().DATABASE_CONFIG_NOT_FOUND);

	const apiKey = createAPIKey();
	const projectId = dbConfig.projectId || null;
	let organisationId: string | null = null;
	if (projectId) {
		const project = await prisma.project.findUnique({
			where: { id: projectId },
			select: { organisationId: true },
		});
		organisationId = project?.organisationId || null;
	}
	const environment =
		typeof dbConfig.environment === "string" && dbConfig.environment.trim()
			? dbConfig.environment.trim()
			: "production";

	await prisma.aPIKeys.create({
		data: {
			apiKey,
			name,
			databaseConfigId: dbConfig.id,
			organisationId,
			projectId,
			environment,
			createdByUserId: user!.id,
		},
	});

	const currentOrganisation = await getCurrentOrganisation();

	if (currentOrganisation?.id) {
		const periodStart = new Date();
		periodStart.setUTCDate(1);
		periodStart.setUTCHours(0, 0, 0, 0);

		const periodEnd = new Date(periodStart);
		periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);

		await recordOrganisationUsageEvent({
			organisationId: currentOrganisation.id,
			featureId: "platform.api-keys",
			periodStart,
			periodEnd,
		});
	}

	return {
		apiKey,
		databaseConfigId: dbConfig.id,
		organisationId,
		projectId,
		environment,
	};
}

export async function getAPIKeyInfo({ apiKey }: { apiKey: string }) {
	return await asaw(
		prisma.aPIKeys.findFirst({
			where: {
				AND: [
					{
						apiKey,
					},
					{
						isDeleted: false,
					},
				],
			},
			include: {
				createdByUser: { select: { email: true } },
				databaseConfig: {
					select: {
						projectId: true,
						environment: true,
						project: { select: { organisationId: true } },
					},
				},
			},
		}).then((row) => {
			if (!row) return row;
			const scope = scopeFromKeyRow(row);
			return {
				...row,
				...scope,
			};
		})
	);
}

export async function getAllAPIKeys(databaseConfigId?: string) {
	let resolvedDatabaseConfigId = databaseConfigId?.trim() || undefined;
	if (!resolvedDatabaseConfigId) {
		const [err, dbConfig] = await asaw(getDBConfigByUser(true));
		throwIfError(err, err);
		throwIfError(!dbConfig?.id, getMessage().DATABASE_CONFIG_NOT_FOUND);
		resolvedDatabaseConfigId = dbConfig.id;
	}

	const [, data] = await asaw(
		prisma.aPIKeys.findMany({
			where: {
				AND: [
					{
						databaseConfigId: resolvedDatabaseConfigId,
					},
					{ isDeleted: false },
				],
			},
			select: {
				name: true,
				apiKey: true,
				createdAt: true,
				id: true,
				createdByUser: {
					select: {
						email: true,
					},
				},
			},
			orderBy: {
				createdAt: "desc",
			},
		})
	);

	if (!Array.isArray(data)) {
		return data;
	}

	return data.map(({ apiKey, ...rest }) => ({
		...rest,
		apiKeyPreview: previewApiKey(apiKey),
	}));
}

export async function deleteAPIKey(id: string) {
	const user = await getCurrentUser();
	throwIfError(!user, getMessage().UNAUTHORIZED_USER);

	const [err, dbConfig] = await asaw(getDBConfigByUser(true));
	throwIfError(err, err);
	throwIfError(!dbConfig?.id, getMessage().DATABASE_CONFIG_NOT_FOUND);

	const apiKey = await prisma.aPIKeys.findFirst({
		where: {
			id,
			databaseConfigId: dbConfig.id,
			isDeleted: false,
		},
	});

	if (!apiKey) {
		throw new Error("API key not found");
	}

	await prisma.aPIKeys.update(
		{ where: { id }, data: { isDeleted: true } }
	);

	return [null, { success: true }];
}

export async function hasAnyAPIKeys(): Promise<boolean> {
	const count = await prisma.aPIKeys.count({
		where: { isDeleted: false },
	});
	return count > 0;
}
