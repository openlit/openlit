import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const STATE_DIR = process.env.E2E_STATE_DIR || "";
const SCREENSHOTS = process.env.E2E_SCREENSHOTS_DIR;
const TARGET = "https://github.com/anthropics/claude-agent-sdk-demos";
const FINDING = "Claude subagent is granted the Bash tool";
const REMOVED_LINE = '-        tools=["Glob", "Read", "Bash", "Write"],';

async function capture(page: Page, name: string) {
	if (!SCREENSHOTS) return;
	mkdirSync(SCREENSHOTS, { recursive: true });
	// Let menus and dialogs finish fading in; spinners loop forever, so skip them.
	await page.evaluate(() =>
		Promise.all(
			document
				.getAnimations()
				.filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
				.map((animation) => animation.finished.catch(() => undefined))
		)
	);
	await page.screenshot({ path: join(SCREENSHOTS, `${name}.png`) });
}

/** Mode and delay for the fake CLI's `enrich` (see e2e/fixtures/bin/trustabl). */
function enrichBehaviour(mode: "fix" | "noop" | "provider-error", delayMs = 0) {
	mkdirSync(STATE_DIR, { recursive: true });
	writeFileSync(join(STATE_DIR, "enrich-mode"), mode);
	writeFileSync(join(STATE_DIR, "enrich-delay-ms"), String(delayMs));
}

async function signIn(page: Page) {
	await page.goto("/login");
	await page.locator("#email").fill("user@openlit.io");
	await page.locator("#password").fill("openlituser");
	await page.locator("button[type=submit]").click();
	await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/** Mutations must be same-origin (CSRF middleware), as they are from the UI. */
function sameOrigin(page: Page) {
	return { Origin: new URL(page.url()).origin };
}

async function ensureConnector(page: Page) {
	const list = await page.request.get("/api/scanners");
	const { connectors = [] } = await list.json();
	if (connectors.length) return;
	const created = await page.request.post("/api/connectors", {
		headers: sameOrigin(page),
		data: {
			category: "scanner",
			type: "trustabl",
			name: "Trustabl – agent SDK demos",
			environment: "production",
			settings: { target: TARGET },
		},
	});
	expect(created.ok(), await created.text()).toBeTruthy();
}

async function scanAndOpenFinding(page: Page) {
	await ensureConnector(page);
	await page.goto("/scanner");
	await page.getByRole("button", { name: "Run scan", exact: true }).click();
	await page.getByText(FINDING).first().click();
	await expect(page.getByRole("heading", { name: FINDING })).toBeVisible();
}

function enrichDialog(page: Page) {
	return page.getByRole("dialog", { name: "Enrich with Trustabl LLM" });
}

test.beforeEach(() => enrichBehaviour("fix"));

test("copies the suggested fix and asks for a Vault key before Enrich", async ({ page }) => {
	await signIn(page);
	await scanAndOpenFinding(page);
	const enrich = page.getByRole("button", { name: "Enrich", exact: true });
	await expect(enrich).toBeEnabled();
	await capture(page, "X01-finding-fix-copy-and-enrich-buttons");

	await page.getByRole("button", { name: "Copy", exact: true }).click();
	await expect(page.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
	await expect(page.getByText("Suggested fix copied to clipboard")).toBeVisible();
	await capture(page, "X02-finding-fix-copied");
	expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Remove "Bash" from this subagent');

	// Runs before the full flow adds the key (one worker, file order).
	await enrich.click();
	const dialog = enrichDialog(page);
	await expect(dialog.getByText("No ANTHROPIC_API_KEY in Vault")).toBeVisible();
	await expect(dialog.getByRole("link", { name: "Add key in Vault" })).toHaveAttribute("href", "/vault");
	await expect(dialog.getByRole("button", { name: "Enrich", exact: true })).toBeDisabled();
});

test("enriches a finding, reviews the diff and handles a failed re-check", async ({ page }) => {
	test.skip(!process.env.E2E_CLICKHOUSE_URL, "Vault needs ClickHouse: set E2E_CLICKHOUSE_URL to run the full flow.");

	await signIn(page);
	const secret = await page.request.post("/api/vault", {
		headers: sameOrigin(page),
		data: { key: "ANTHROPIC_API_KEY", value: "sk-ant-e2e-fake-key-0000000000", tags: [] },
	});
	expect(secret.ok(), await secret.text()).toBeTruthy();
	await scanAndOpenFinding(page);

	// X03: dialog with the Vault key found.
	enrichBehaviour("fix", 4000);
	await page.getByRole("button", { name: "Enrich", exact: true }).click();
	const dialog = enrichDialog(page);
	await expect(dialog.getByText("ANTHROPIC_API_KEY from Vault")).toBeVisible();
	await expect(dialog.getByText("Other CSDK-101 findings", { exact: false })).toHaveCount(0);
	await capture(page, "X03-enrich-dialog");
	await dialog.getByRole("button", { name: "Enrich", exact: true }).click();
	await expect(dialog).toBeHidden();

	// X04: running.
	await expect(page.getByText("Enriching with Trustabl LLM · Trustabl default")).toBeVisible();
	await expect(page.getByRole("button", { name: "Enriching…" })).toBeDisabled();
	await expect(page.getByText("Clone repository")).toBeVisible();
	await expect(page.getByText(/main @ 826b268|HEAD @ 826b268/)).toBeVisible();
	await capture(page, "X04-enrich-running");

	// X05: diff ready for review.
	await expect(page.getByText("Enrich ready for review")).toBeVisible();
	await expect(page.getByText("CSDK-101 resolved · 0 new findings")).toBeVisible();
	await expect(page.getByText(REMOVED_LINE)).toBeVisible();
	await capture(page, "X05-enrich-diff-review");
	await page.getByRole("button", { name: "Copy diff" }).click();
	expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(REMOVED_LINE);
	await page.getByRole("button", { name: "Discard" }).click();
	await expect(page.getByText("Enrich ready for review")).toBeHidden();

	// X08: the LLM edits the wrong line twice, so the re-check still flags the finding.
	enrichBehaviour("noop");
	await page.getByRole("button", { name: "Enrich", exact: true }).click();
	await dialog.getByRole("combobox", { name: "Attempts" }).click();
	await page.getByRole("option", { name: "Up to 2 attempts" }).click();
	await dialog.getByRole("button", { name: "Enrich", exact: true }).click();
	await expect(page.getByText("Enrich not applied: CSDK-101 is still detected after 2 attempts")).toBeVisible();
	await expect(page.getByText(/still detected at research-agent\/research_agent\/agent\.py:4-9/)).toBeVisible();
	await capture(page, "X08-enrich-failed-recheck");
	await page.getByRole("button", { name: "View log" }).click();
	await expect(page.getByText("enriching 1/1 findings (grouped by file)").first()).toBeVisible();
	await page.getByRole("button", { name: "View partial diff" }).click();
	// The log repeats each attempt's diff; the partial diff view renders last.
	await expect(page.getByText("Analyses research notes and summarises them.", { exact: false }).last()).toBeVisible();

	// Retry with a working LLM.
	enrichBehaviour("fix");
	await page.getByRole("button", { name: "Retry" }).click();
	await expect(page.getByText("Enrich ready for review")).toBeVisible();
});
