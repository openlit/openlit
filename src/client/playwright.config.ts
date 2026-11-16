import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "os";
import { delimiter, join } from "path";

const PORT = Number(process.env.E2E_PORT || 3011);
const BASE_URL = `http://localhost:${PORT}`;
const STATE_DIR = join(tmpdir(), "openlit-e2e");
const FIXTURE_BIN = join(__dirname, "e2e", "fixtures", "bin");

// Hermetic server: its own SQLite file, build directory and fake Trustabl CLI.
const serverEnv = {
	E2E_STATE_DIR: STATE_DIR,
	SQLITE_DATABASE_URL: `file:${join(STATE_DIR, "openlit-e2e.db")}`,
	NEXTAUTH_SECRET: "openlit-e2e-secret",
	NEXTAUTH_URL: BASE_URL,
	OPENLIT_NEXT_DIST_DIR: ".next-e2e",
	OPENLIT_RUNTIME_CACHE: join(STATE_DIR, "cache"),
	TRUSTABL_BIN: join(FIXTURE_BIN, "trustabl"),
	// Shadows `crontab` so startup cron installs never touch the real one.
	PATH: `${FIXTURE_BIN}${delimiter}${process.env.PATH || ""}`,
	API_URL: BASE_URL,
	TELEMETRY_ENABLED: "false",
	INIT_DB_HOST: "",
	INIT_DB_PORT: "",
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
	webServer: {
		command: `node e2e/prepare.js && npx next dev -p ${PORT}`,
		url: `${BASE_URL}/login`,
		env: serverEnv,
		reuseExistingServer: false,
		timeout: 300_000,
		stdout: "ignore",
		stderr: "pipe",
	},
});
