# OpenLIT Contributor Rules

## Repository Scope

- This repository is the open-source CE/OSS codebase.
- Do not add enterprise implementation files here.
- CE may contain shared contracts, feature IDs, disabled feature placeholders, and upgrade-required responses.
- Enterprise-only implementation belongs in the private `openlit-enterprise` repository under `src/client/src/ee/`.

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
- Do not hard-code user-facing strings in React, route handlers, or library errors. Add them to `src/client/src/constants/messages/en.ts`.
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
