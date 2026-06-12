# OpenLIT Contributor Rules

## Repository Scope

- This repository is the open-source CE/OSS codebase.
- Do not add enterprise implementation files here.
- CE may contain shared contracts, feature IDs, empty feature lists, disabled feature placeholders, upgrade-required responses, and OSS-safe no-op extension fallbacks.
- Enterprise-only implementation belongs in the private `openlit-enterprise` repository under `src/client/src/ee/`.
- If shared code needs an enterprise extension point, add a stable shared import with a CE no-op fallback here, then let `openlit-enterprise` override it from `src/client/src/ee/**`.
- Do not add enterprise-only libraries, stores, selectors, middleware behavior, feature rules, billing logic, license logic, audit implementation, or UI here.

## Project Hierarchy

OpenLIT uses this hierarchy:

```text
Organisation
  Project
    Database configuration
```

- Organisation is the account and membership boundary.
- Project is the workspace boundary for database configurations.
- Database configs must be read, created, selected, and shared through the current project.
- New organisation flows must ensure a default project exists.
- Switching organisation must refresh projects, database configs, and the active DB ping state.

## UI Rules

- Follow the existing settings-page classes for light and dark mode.
- Do not hard-code user-facing strings in React, route handlers, or library errors. Add CE strings to `src/client/src/constants/messages/en.ts`; enterprise-only strings belong in `src/client/src/ee/constants/messages/en.ts` in the private repo.
- Use compact controls in settings and telemetry-style data pages.
- Keep project and organisation switchers in the header; breadcrumbs belong below the header.

## Testing Rules

- Add tests with the change, not afterwards.
- For project hierarchy changes, cover membership denial, current project selection, cross-project DB config denial, and default project fallback.
- For route handlers, test invalid JSON and authorization boundaries.
- Before handing off, run:

```bash
cd src/client
npm test -- --runInBand
npm run lint
npx prisma validate --schema prisma/schema.prisma
```

## Security Rules

- UI feature checks are presentation only. Server routes must enforce authorization.
- Do not log raw secrets, tokens, passwords, cookies, license keys, or authorization headers.
- Audit metadata must be redacted before persistence.
- Internal APIs must use constant-time key comparisons.
- Stripe webhooks must verify signatures before processing payloads.
