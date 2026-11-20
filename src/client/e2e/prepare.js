/**
 * Fresh SQLite database and runtime cache for the e2e dev server.
 * Runs before `next dev` so the server never sees a half-migrated database.
 *
 * With `E2E_CLICKHOUSE_URL` (http://user:password@host:port) it also recreates
 * the `openlit_e2e` ClickHouse database that the seeded Default DB points at,
 * so Vault works for the full Enrich flow.
 */
const { execSync } = require("child_process");
const { mkdirSync, rmSync } = require("fs");
const { join } = require("path");

const state = process.env.E2E_STATE_DIR;
if (!state) throw new Error("E2E_STATE_DIR is required");

async function resetClickHouse(raw) {
	const url = new URL(raw);
	const database = process.env.INIT_DB_DATABASE || "openlit_e2e";
	const headers = {};
	if (url.username) {
		const credentials = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`;
		headers.Authorization = `Basic ${Buffer.from(credentials).toString("base64")}`;
	}
	for (const query of [`DROP DATABASE IF EXISTS ${database}`, `CREATE DATABASE ${database}`]) {
		const response = await fetch(url.origin, { method: "POST", headers, body: query });
		if (!response.ok) throw new Error(`ClickHouse: ${query} failed with HTTP ${response.status}`);
	}
}

async function main() {
	rmSync(state, { recursive: true, force: true });
	mkdirSync(join(state, "cache"), { recursive: true });
	if (process.env.E2E_CLICKHOUSE_URL) await resetClickHouse(process.env.E2E_CLICKHOUSE_URL);

	const options = { cwd: join(__dirname, ".."), stdio: "inherit", env: process.env };
	execSync("npx prisma migrate deploy", options);
	execSync("node prisma/seed.js", options);
}

main().catch((error) => {
	process.stderr.write(`${error.message}\n`);
	process.exit(1);
});
