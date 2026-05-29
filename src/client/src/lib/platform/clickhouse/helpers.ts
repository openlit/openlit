import migrations from "@/clickhouse/migrations";
import { dataCollector } from "../common";
import asaw from "@/utils/asaw";
import { getFirstDBConfig } from "@/lib/db-config";

export async function pingClickhouse() {
	const pingResponse = await dataCollector({}, "ping");
	if (pingResponse.data) {
		const [err] = await asaw(runClickhouseMigrations());
		return {
			err,
			data: !err,
		};
	}

	return pingResponse;
}

export async function runClickhouseMigrations() {
	const dbConfig = await getFirstDBConfig();
	if (!dbConfig?.id) {
		console.log("No ClickHouse DB config found; skipping migrations");
		return;
	}

	await migrations(dbConfig.id);
}
