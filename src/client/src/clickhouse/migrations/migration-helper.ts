import getMessage from "@/constants/messages";
import { getDBConfigById, getDBConfigByUser } from "@/lib/db-config";
import { dataCollector } from "@/lib/platform/common";
import prisma from "@/lib/prisma";
import asaw from "@/utils/asaw";
import { consoleLog } from "@/utils/log";

type MigrationQuery =
	| string
	| { type: "insert"; table: string; values: Record<string, unknown>[] };

export default async function migrationHelper({
	clickhouseMigrationId,
	queries,
	databaseConfigId,
}: {
	clickhouseMigrationId: string;
	queries: MigrationQuery[];
	databaseConfigId?: string;
}) {
	let err, dbConfig;
	if (databaseConfigId) {
		[err, dbConfig] = await asaw(getDBConfigById({ id: databaseConfigId }));
	} else {
		[err, dbConfig] = await asaw(getDBConfigByUser(true));
	}

	if (err || !dbConfig?.id) throw err || getMessage().DATABASE_CONFIG_NOT_FOUND;

	const [, migrationExist] = await asaw(
		prisma.clickhouseMigrations.findFirst({
			where: {
				AND: {
					databaseConfigId: dbConfig.id as string,
					clickhouseMigrationId,
				},
			},
		})
	);

	if (migrationExist?.id) {
		return { migrationExist: true, queriesRun: false };
	}

	const queriesRun: Array<{ err?: unknown }> = [];
	for (const query of queries) {
		if (typeof query === "string") {
			const { err } = await dataCollector(
				{ query },
				"exec",
				dbConfig.id
			);
			if (err) {
				console.log(
					`********* Migration Error : ${clickhouseMigrationId} *********`
				);
				consoleLog(err);
				console.log(
					`********* Migration Error : ${clickhouseMigrationId} *********`
				);
			}
			queriesRun.push({ err });
		} else if (query.type === "insert") {
			const { err } = await dataCollector(
				{
					table: query.table,
					values: query.values,
				},
				"insert",
				dbConfig.id
			);
			if (err) {
				console.log(
					`********* Migration Error : ${clickhouseMigrationId} (insert) *********`
				);
				consoleLog(err);
			}
			queriesRun.push({ err });
		} else {
			queriesRun.push({ err: new Error("Unknown query type") });
		}
	}

	if (queriesRun.filter(({ err }) => !err).length === queries.length) {
		await asaw(
			prisma.clickhouseMigrations.create({
				data: {
					databaseConfigId: dbConfig.id,
					clickhouseMigrationId,
				},
			})
		);

		return { migrationExist: false, queriesRun: true };
	}

	return { migrationExist: false, queriesRun: false };
}
