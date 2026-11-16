import { defineConfig, devices } from "@playwright/test";
import { delimiter, join } from "path";

const PORT = Number(process.env.E2E_PORT || 3011);
const GITHUB_PORT = Number(process.env.E2E_GITHUB_PORT || 3012);
const BASE_URL = `http://localhost:${PORT}`;
// Inside the client folder (git-ignored) rather than the OS temp dir: Enrich
// runs the CLI with a minimal environment, and the fake CLI finds its state
// here from its own location.
const STATE_DIR = join(__dirname, ".e2e-state");
const FIXTURE_BIN = join(__dirname, "e2e", "fixtures", "bin");

/** Seeded Default DB pointing at an e2e ClickHouse database, when one is given. */
function clickHouseEnv(): Record<string, string> {
	const raw = process.env.E2E_CLICKHOUSE_URL;
	if (!raw) return { INIT_DB_HOST: "", INIT_DB_PORT: "" };
	const url = new URL(raw);
	return {
		E2E_CLICKHOUSE_URL: raw,
		INIT_DB_HOST: `${url.protocol}//${url.hostname}`,
		INIT_DB_PORT: url.port || "8123",
		INIT_DB_USERNAME: decodeURIComponent(url.username) || "default",
		INIT_DB_PASSWORD: decodeURIComponent(url.password),
		INIT_DB_DATABASE: "openlit_e2e",
	};
}

// Hermetic server: its own SQLite file, build directory, fake Trustabl CLI
// and fake GitHub API.
const serverEnv = {
	E2E_STATE_DIR: STATE_DIR,
	SQLITE_DATABASE_URL: `file:${join(STATE_DIR, "openlit-e2e.db")}`,
	NEXTAUTH_SECRET: "openlit-e2e-secret",
	NEXTAUTH_URL: BASE_URL,
	OPENLIT_NEXT_DIST_DIR: ".next-e2e",
	OPENLIT_RUNTIME_CACHE: join(STATE_DIR, "cache"),
	OPENLIT_GITHUB_API_URL: `http://localhost:${GITHUB_PORT}`,
	TRUSTABL_BIN: join(FIXTURE_BIN, "trustabl"),
	// Shadows `crontab` so startup cron installs never touch the real one.
	PATH: `${FIXTURE_BIN}${delimiter}${process.env.PATH || ""}`,
	API_URL: BASE_URL,
	TELEMETRY_ENABLED: "false",
	...clickHouseEnv(),
};

process.env.E2E_STATE_DIR = STATE_DIR;

export default defineConfig({
	testDir: "./e2e",
	timeout: 180_000,
	expect: { timeout: 30_000 },
	fullyParallel: false,
	workers: 1,
	reporter: [["list"]],
	use: {
		baseURL: BASE_URL,
		permissions: ["clipboard-read", "clipboard-write"],
		trace: "retain-on-failure",
		viewport: { width: 1512, height: 900 },
	},
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1512, height: 900 } } }],
	webServer: [
		{
			command: "node e2e/fixtures/github.js",
			url: `http://localhost:${GITHUB_PORT}/health`,
			env: { E2E_GITHUB_PORT: String(GITHUB_PORT) },
			reuseExistingServer: false,
			stdout: "ignore",
			stderr: "pipe",
		},
		{
			command: `node e2e/prepare.js && npx next dev -p ${PORT}`,
			url: `${BASE_URL}/login`,
			env: serverEnv,
			reuseExistingServer: false,
			timeout: 300_000,
			stdout: "ignore",
			stderr: "pipe",
		},
	],
});
