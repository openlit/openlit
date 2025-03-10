import migrations from "@/clickhouse/migrations";
import { dataCollector } from "../common";

export async function pingClickhouse() {
	const data = await dataCollector({}, "ping");
	runClickhouseMigrations()
	return data;
}

export async function runClickhouseMigrations() {
	await migrations();
}
