# Merge Readiness And Security Findings

Date: 2026-06-09

Scope:
- OSS PR: `openlit/openlit#1226`
- Enterprise PR: `openlit/openlit-enterprise#20`
- Focus areas: organisation -> project -> database config hierarchy, EE audit logs, licensing, entitlements, billing/internal APIs, and merge readiness.

## Verdict

Ready from the automated checks run in this review.

The blockers found in the previous review have been addressed in both CE and EE:
- focused project/db-config tests now pass,
- `setCurrentDBConfig()` is scoped to the current project,
- EE license narrowing disables stale license-sourced entitlements,
- project creation is length-limited,
- project and license mutation routes return clean `400` responses for invalid JSON.

Remaining merge confidence depends on the GitHub CI environment and a browser smoke test, but local full Jest, lint, Prisma validation, and diff checks are passing in both CE and EE.

## Validation Run

OSS:
- Passed: `npx prisma validate --schema prisma/schema.prisma`
- Passed: `git diff --check`
- Passed: `npm run lint`
- Passed: `npm test -- --runInBand`
- Result: 146 passed suites, 2048 passed tests, 1 passed snapshot

Enterprise:
- Passed: `npx prisma validate --schema prisma/schema.prisma`
- Passed: `git diff --check`
- Passed: `npm run lint`
- Passed: `npm test -- --runInBand`
- Result: 148 passed suites, 2058 passed tests, 1 passed snapshot

## Fixed Findings

### 1. High: License narrowing left stale paid entitlements enabled

Status: Fixed in EE.

File:
- `openlit-enterprise/src/client/src/ee/lib/license.ts`

Fix:
`applySignedLicense()` now disables `source: "license"` entitlements for the organisation where `featureId` is absent from the newly applied license payload before enabling the payload features.

Regression coverage:
- `openlit-enterprise/src/client/src/__tests__/lib/license.test.ts`

### 2. Medium: Current DB config could be set outside the selected project

Status: Fixed in CE and EE.

Files:
- `openlit/src/client/src/lib/db-config.ts`
- `openlit-enterprise/src/client/src/lib/db-config.ts`

Fix:
`setCurrentDBConfig(id)` now resolves the current project and requires the target database config to belong to that project before updating current-selection rows.

Regression coverage:
- `src/client/src/__tests__/lib/db-config.test.ts` in both repos

### 3. Medium: Tests were not updated for the project layer

Status: Fixed in CE and EE for focused suites and full Jest.

Files:
- `src/client/src/__tests__/lib/db-config.test.ts`
- `src/client/src/__tests__/lib/organisation.test.ts`
- `src/client/src/__tests__/helpers/client/organisation.test.ts`
- `openlit-enterprise/src/client/src/__tests__/lib/license.test.ts`
- `openlit-enterprise/src/client/src/__tests__/lib/platform/api-keys/api-keys.test.ts`

Fix:
Mocks now include project model access, current-project helpers, client project store state, and raw current-project SQL helpers where the production code still uses them. Expectations now validate project-scoped DB config behavior. EE API key tests also mock current organisation/billing usage so enterprise usage recording is covered without falling through to unrelated production dependencies.

### 4. Low: Project creation accepted unbounded names

Status: Fixed in CE and EE.

Files:
- `src/client/src/app/api/organisation/[id]/projects/route.ts`
- `openlit/src/client/src/lib/organisation.ts`
- `openlit-enterprise/src/client/src/ee/lib/organisation-billing.ts`

Fix:
Project names are trimmed and limited to 1-120 characters. Invalid names return `400` at the API layer and throw a validation error in the library layer.

### 5. Low: Invalid JSON could produce noisy 500s

Status: Fixed for the reviewed new mutation routes.

Files:
- `src/client/src/app/api/organisation/[id]/projects/route.ts`
- `openlit-enterprise/src/client/src/app/api/organisation/[id]/license/route.ts`

Fix:
The reviewed routes now parse JSON through a small helper and return `400` for malformed bodies.

## Remaining Risks

### Raw SQL current-project helper

File:
- `src/client/src/lib/organisation.ts`

Status: Accepted temporary risk.

`getMembershipCurrentProjectId()` and `setMembershipCurrentProjectId()` still use Prisma tagged `$queryRaw` / `$executeRaw` against `organisation_users.current_project_id`.

Security note:
The current code uses Prisma tagged templates, so SQL injection risk is low.

Residual risk:
This bypasses generated Prisma model typing and can drift if the database column or Prisma schema changes. Keep this isolated and switch back to typed Prisma reads/writes once the generated client issue is resolved.

### Browser smoke confidence

Status: Pending browser smoke.

The full local Jest suites, lint, Prisma validation, and diff checks pass in both repos. I did not run a Playwright/manual browser pass in this review.

Recommended smoke checks before merge:
- Create organisation -> default project exists -> current project is default.
- Create project -> project appears in header dropdown without refresh.
- Switch project -> DB config list updates.
- Create DB config in project A -> not visible in project B.
- Attempt to set current DB config from another project -> rejected.
- EE: apply license with feature set A+B, then apply license with only A -> B entitlement disabled.
- EE: audit logs page remains locked without entitlement and loads with `enterprise.audit-log`.

## Security Notes

These areas looked reasonable in the reviewed code:
- Project list route checks `organisationUser` membership before returning projects.
- Project switch route checks membership and verifies the target project belongs to the organisation.
- DB config reads filter by current project.
- `setCurrentDBConfig()` now validates the target config is in the current project.
- EE license application revokes stale license-sourced entitlements during license replacement.
- Internal cloud API route is allowed through middleware but protected by `OPENLIT_INTERNAL_API_KEY` using `crypto.timingSafeEqual`.
- Stripe webhook validates `stripe-signature` using the configured webhook secret.
- Audit middleware redacts sensitive key names such as password, secret, token, API key, license key, authorization, cookie, and session before writing metadata.
- Audit log read API requires organisation billing admin and enterprise audit-log entitlement.

## Merge Checklist

Before merging:
1. Run full CI for both PRs.
2. Regenerate Prisma clients in the CI/build environment.
3. Run a browser smoke test for organisation/project/db-config switching in CE and EE.
4. Run an EE audit-log entitlement smoke test.
