/**
 * Fresh SQLite database and runtime cache for the e2e dev server.
 * Runs before `next dev` so the server never sees a half-migrated database.
 */
const { execSync } = require("child_process");
const { mkdirSync, rmSync } = require("fs");
const { join } = require("path");

const state = process.env.E2E_STATE_DIR;
if (!state) throw new Error("E2E_STATE_DIR is required");

rmSync(state, { recursive: true, force: true });
mkdirSync(join(state, "cache"), { recursive: true });

const options = { cwd: join(__dirname, ".."), stdio: "inherit", env: process.env };
execSync("npx prisma migrate deploy", options);
execSync("node prisma/seed.js", options);
