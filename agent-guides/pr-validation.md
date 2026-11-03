# OpenLIT PR Review and Validation Workflow

This workflow validates a pull request end to end, in either repository. It applies to Claude Code, Cursor, Codex, and any other agent that reads `AGENTS.md`.

The goal is a verified report of what is wrong, what is missing, and what was proven to work. Every finding must be reproduced or traced to a specific line before it is reported.

## When to run

The workflow is long and starts apps, databases, and parallel agents, so it runs **only when someone asks for it**:

- **Run it** when the request explicitly asks to validate a PR or run this workflow, for example "validate this PR", "run the validation workflow", "run PR validation", or `/pr-validation` in Claude Code.
- **Offer it, don't run it,** when a PR looks ready:
  - you opened or updated a PR;
  - you finished the work on a branch and pushed it;
  - someone says their PR is ready, or asks for a quick review.

  Ask exactly once: "Your PR looks ready. Should I run the validation workflow?" Start only after a clear yes. If they decline, don't ask again for the same changes.
- A plain request to review code ("review this", "look over my changes") gets a normal code review. Mention that the full validation workflow is available.

## 0. Scope the change

1. Identify the PR: number or URL if given, otherwise the current branch against `main`.
2. List the changed files with `gh pr diff <number> --name-only` or `git diff --name-only origin/main...HEAD`.
3. Find the paired PR. CE (`openlit/openlit`) and enterprise (`openlit/openlit-enterprise`) changes usually ship together on the same branch name. Review both, and treat any drift between shared files as a finding.
4. Classify every changed file:
   - **Shared:** identical in both repos.
   - **CE-only:** fallbacks and OSS-safe stubs.
   - **EE-only:** `src/client/src/ee/**` and thin `app/**` wrappers.
   - **Docs, migrations, tests, config.**
5. List every route, page, Prisma model, migration, extension point, and user-facing string the change touches. Every lane below works from this inventory.

## 1. Run the lanes in parallel

Each lane is independent. Run them in parallel when the agent supports subagents. Otherwise run them in this order. Each lane produces findings in the [report format](#3-report).

### Lane A: Security

Follow `agent-guides/security-testing.md` and the `security-validation` checklist, then go further.

- **Authorization:** every touched route enforces authentication and authorization on the server. Check the signed-out, wrong-role, wrong-organisation, wrong-project, API-key, and stale-session cases. UI checks don't count.
- **Input:** malformed JSON returns `400`. Validate identifiers, enforce size limits, reject unknown keys, and block path traversal and header injection.
- **Secrets:** no passwords, tokens, cookies, API keys, license keys, or authorization headers in responses, logs, or audit metadata.
- **Outbound requests:** any URL or host an admin or user can set must be checked for SSRF, including IP literals, bracketed IPv6, IPv4-mapped IPv6, DNS that resolves to private addresses, redirects, and DNS rebinding.
- **Authentication flows:** check account linking, email verification, session claims, CSRF on mutations, and privilege escalation (for example becoming an organisation owner or instance admin).
- **Live attack test:** run the app (see [Run the app](#run-the-app)) and attack each new route with `curl` as signed-out, member, admin, and a forged token. Record the status codes.
- **Existing architecture:** check the change against `Organisation -> Project -> Database configuration`, connectors, and environments:
  - Cross-organisation and cross-project access is denied.
  - Switching organisation or project refreshes the dependent state.
  - Database config reads and writes are scoped to the current project.
  - Connector bindings and environments keep working.

### Lane B: Functional validation and shortcomings

- Run every user flow the PR adds or changes in the running app, in both CE and enterprise when both are affected. Take screenshots in light and dark mode.
- **Shortcomings:** list what the feature doesn't handle, then try each item. For example:
  - Empty, loading, error, disabled, and locked states.
  - Unlicensed and expired-license cases.
  - The first-run and upgrade paths.
  - Concurrent edits and stale sessions.
  - Very long values, and how it renders at narrow widths.
  - The behaviour when a dependency (ClickHouse, the license server, an identity provider) is down.
  - Migrations on an existing database.
- Report each shortcoming as a finding (a bug or a gap), or as **Verified** with how you proved it works.

### Lane C: Scale testing with mock data

1. Create a throwaway database and seed it at volume:

   ```bash
   cd src/client
   export SQLITE_DATABASE_URL="file:/tmp/openlit-scale.db"
   npx prisma migrate deploy --schema prisma/schema.prisma
   node prisma/seed.js
   node scripts/pr-validation/seed-scale-data.js --throwaway
   ```

   Tune the volume with `SCALE_USERS`, `SCALE_ORGS`, `SCALE_MEMBERS_PER_ORG`, `SCALE_PROJECTS_PER_ORG`, `SCALE_ENVIRONMENTS_PER_PROJECT`, `SCALE_INVITES_PER_ORG`, and `SCALE_INSTANCE_ADMINS`. Mock users sign in with the password `openlituser`.
2. Start the app against that database and time every touched route and page, using `curl -w '%{time_total}'` or a browser trace.
3. Look for:
   - Unbounded queries and missing pagination.
   - N+1 queries and missing indexes (`EXPLAIN QUERY PLAN` in SQLite).
   - Per-request work in middleware or the session callbacks.
   - UI that renders every row.
4. Report the measured timings next to the volumes used. Never run the seeder against a database with real data.

### Lane D: Hard-coded strings

- No user-facing text in components, toasts, errors, `aria-label`s, placeholders, or API error bodies. CE strings belong in `src/client/src/constants/messages/en.ts`; enterprise-only strings belong in `src/client/src/ee/constants/messages/en.ts`.
- Scan the changed files for JSX text and string literals passed to `toast`, `title`, `placeholder`, `aria-label`, `label`, and `Response.json({ error: ... })`, then review each match. Existing patterns outside the diff aren't findings for this PR, but list them separately as follow-ups.
- Enterprise-only copy must not appear in the CE message file.

### Lane E: Documentation and CE/EE separation

- Every new feature, setting, environment variable, route, and permission is documented under `docs/latest/`, following `agent-guides/documentation.md`.
- Enterprise features are tagged:
  - `tag: 'Enterprise'` in the page front matter, plus the `EnterpriseFeature` snippet.
  - An availability table showing Community versus Enterprise.
  - A row in the feature table on `docs/latest/openlit/enterprise.mdx`.
- New environment variables are listed in `docs/latest/openlit/configuration.mdx`.
- New audit actions are listed in `docs/latest/openlit/audit-logs.mdx`.
- New pages are added to `docs/docs.json`.
- Docs are identical in both repos, apart from the intentional enterprise-only pages.
- Run `npx mint broken-links` in `docs/` and report every broken link the PR introduces.
- **Code separation:** no enterprise implementation in CE.
  - Shared files use neutral import paths. `@/ee/**` imports appear only under `src/client/src/ee/**`, in tests, and in thin enterprise `app/**` wrappers.
  - CE fallbacks are OSS-safe no-ops or upgrade-required responses.
  - No RBAC permission literals in shared files.
  - Run the leakage scans from `AGENTS.md`.

### Lane F: Reusable components

- Look for new components, hooks, helpers, and API wrappers that duplicate existing ones (for example `FeaturePageHeader`, `ConfirmationModal`, `useFetchWrapper`, the `components/ui/*` primitives, sidebar and shell components, and validation helpers in `utils/validation.ts`).
- Look for logic repeated across CE and enterprise that belongs in a shared module behind an extension point.
- Report anything that should be extracted, and anything that reimplements an existing helper.

### Lane G: Design principles

- **UI:** follow the `agent-guides/frontend.md` checklist:
  - Light and dark themes, no one-off colours, no cards inside cards.
  - Header switchers with breadcrumbs below.
  - Every state covered: loading, empty, disabled, error, and locked.
  - Narrow widths don't scroll horizontally.
  - Keyboard and screen-reader access: labels, focus, roles, and `aria-*`.
- **Code:**
  - CE first, then synced into enterprise; thin route wrappers.
  - Neutral extension points, each with a CE fallback.
  - Organisation and project scoping.
  - Server-side authorization; no secrets in logs.
  - Match the surrounding code: naming, comment density, and idioms.
- **Data:** check migrations against the schema with `prisma migrate diff` on a freshly migrated database. Look for indexes on new lookups, and for backward-compatible changes for existing installs.

### Lane H: Cross-agent testing

- **Independent verification:** hand every finding from lanes A to G to a separate agent (or a fresh pass) that tries to **disprove** it by reading the code path and reproducing it. Keep only findings it confirms. Mark the rest **Unconfirmed**, with the reason.
- **Coding agent integrations:** if the PR touches coding-agent hooks, telemetry conventions, or the coding agents pages (`cli/internal/coding/**`, `agent-guides/coding-agents-*.md`, coding agents dashboards), test the change with every supported coding agent, not only one, and compare the spans each produces.
- **Agent instructions:** if the PR changes `AGENTS.md`, `agent-guides/`, `.cursor/rules/`, or `.claude/`, check that each tool's wrapper still points to the same canonical guide.

## 2. Required checks

Run these in `src/client` of **each** affected repo, and quote the result lines in the report:

```bash
npx tsc --noEmit -p .
npm test -- --runInBand
npm run lint
npx prisma validate --schema prisma/schema.prisma
```

Then run the CE/EE leakage scans from `AGENTS.md`.

## 3. Report

Lead with a verdict: **Ready to merge**, **Ready after fixes**, or **Not ready**. Then:

| Severity | Lane | File:line | Finding | Evidence | Fix |
| --- | --- | --- | --- | --- | --- |

- **Severity:** Critical (exploitable or data loss), High (broken feature or security weakness), Medium (gap or wrong edge case), Low (cleanup).
- **Evidence:** the command, request, test, or screenshot that proves it.
- After the table, list what was verified to work, the scale results, the required check results, and the shortcomings that are acceptable as-is, with reasons.
- Don't apply fixes unless the requester asks. When asked, fix CE first, sync shared files to enterprise, add a test for each security fix, and re-run section 2.

## Run the app

Run against throwaway databases only.

- **Enterprise:** `OPENLIT_EDITION=enterprise`, plus `OPENLIT_LICENSE_SERVER_URL` and `OPENLIT_LICENSE_PUBLIC_KEY` when testing licensed features against a local license server.
- **CE:** the same command without the edition variable.

```bash
cd src/client
export SQLITE_DATABASE_URL="file:/tmp/openlit-review.db" NEXTAUTH_SECRET=review-only NEXTAUTH_URL=http://localhost:3005/
npx prisma migrate deploy --schema prisma/schema.prisma && node prisma/seed.js
npx next dev -p 3005
```

The seeded account is `user@openlit.io` with password `openlituser`, and it is the instance admin.
