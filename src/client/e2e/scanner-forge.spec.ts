import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

const STATE_DIR = process.env.E2E_STATE_DIR || "";
const STALE_FLAG = join(STATE_DIR, "forge-stale");
const SCREENSHOTS = process.env.E2E_SCREENSHOTS_DIR;
const TARGET = "https://github.com/anthropics/claude-agent-sdk-demos";

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

async function signIn(page: Page) {
	await page.goto("/login");
	await page.locator("#email").fill("user@openlit.io");
	await page.locator("#password").fill("openlituser");
	await page.locator("button[type=submit]").click();
	await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

async function openRunMenu(page: Page) {
	await page.getByRole("button", { name: "More Analyzer and Forge options" }).click();
}

function forgeTab(page: Page) {
	return page.getByRole("tab", { name: /Forge skill/ });
}

test.afterAll(() => {
	rmSync(STALE_FLAG, { force: true });
});

test("forges, reviews and regenerates a pre-coding skill", async ({ page }) => {
	await signIn(page);
	const created = await page.request.post("/api/connectors", {
		// Mutations must be same-origin (CSRF middleware), as they are from the UI.
		headers: { Origin: new URL(page.url()).origin },
		data: {
			category: "scanner",
			type: "trustabl",
			name: "Trustabl – agent SDK demos",
			environment: "production",
			settings: { target: TARGET },
		},
	});
	expect(created.ok(), await created.text()).toBeTruthy();

	// Analyzer scan: its SDKs prefill the Forge policies.
	await page.goto("/scanner");
	await page.getByRole("button", { name: "Run Analyzer", exact: true }).click();
	await expect(page.getByRole("tab", { name: /Analyzer findings\s*3/ })).toBeVisible();
	await expect(page.getByText("Claude subagent is granted the Bash tool")).toBeVisible();

	// F02: empty Forge tab.
	await forgeTab(page).click();
	await expect(page.getByText("No skill forged for this repository yet")).toBeVisible();
	await expect(page.getByText("Uses SDKs from the latest Analyzer scan: claude_sdk, mcp")).toBeVisible();
	await capture(page, "F02-skill-tab-empty");

	// F01: run menu with the Forge group.
	await openRunMenu(page);
	const runForge = page.getByRole("menuitem", { name: /Run Forge.*claude_sdk, mcp/ });
	await expect(runForge).toBeVisible();
	await capture(page, "F01-run-menu-analyzer-and-forge");
	await runForge.click();

	// F04: running state, visible only when the fake CLI is slowed down.
	if (process.env.E2E_FORGE_DELAY_MS) {
		await expect(page.getByText("Forging pre-coding skill…")).toBeVisible();
		await expect(page.getByText("$ trustabl forge --policy claude_sdk,mcp")).toBeVisible();
		await capture(page, "F04-forge-running");
	}

	// F05: skill panel.
	await expect(forgeTab(page).getByText("Current")).toBeVisible();
	await expect(page.getByText("trustabl-pre-coding · SKILL.md")).toBeVisible();
	const rules = page.getByText("Rules", { exact: true }).locator("..").locator("..");
	await expect(rules).toContainText("75");
	await expect(page.getByRole("navigation", { name: "Outline" }).getByRole("button", { name: /Tool Rules/ }).first()).toBeVisible();
	await capture(page, "F05-skill-panel-preview");

	// F06: raw view and copy.
	await page.getByRole("tab", { name: "Raw SKILL.md" }).click();
	await expect(page.locator("pre").filter({ hasText: "name: trustabl-pre-coding" })).toBeVisible();
	await page.getByRole("button", { name: "Copy", exact: true }).click();
	await expect(page.getByText("SKILL.md copied to clipboard")).toBeVisible();
	await expect(page.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
	await capture(page, "F06-skill-panel-raw-copied");
	expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("name: trustabl-pre-coding");

	// F03: parameters dialog, prefilled from the Analyzer scan.
	await openRunMenu(page);
	await page.getByRole("menuitem", { name: "Run Forge with new parameters" }).click();
	const dialog = page.getByRole("dialog");
	await expect(dialog.getByRole("button", { name: "claude_sdk" })).toHaveAttribute("aria-pressed", "true");
	await expect(dialog.getByRole("button", { name: "openai_sdk" })).toHaveAttribute("aria-pressed", "false");
	await capture(page, "F03-run-forge-parameters-dialog");
	await dialog.getByRole("button", { name: "Cancel" }).click();
	await expect(dialog).toBeHidden();

	// F09: rules moved on; forge check reports the skill as stale.
	writeFileSync(STALE_FLAG, "");
	await page.reload();
	await forgeTab(page).click();
	await expect(page.getByText("This skill is stale. The rules changed after it was generated.")).toBeVisible();
	await expect(page.getByText(/outdated: generated from 9eca09d/)).toBeVisible();
	await capture(page, "F09-skill-stale-regenerate");
	rmSync(STALE_FLAG, { force: true });
	await page.getByRole("button", { name: "Regenerate" }).last().click();
	await expect(forgeTab(page).getByText("Current")).toBeVisible();

	await page.getByRole("combobox", { name: "Forge run" }).click();
	await expect(page.getByRole("option")).toHaveCount(2);
});
