# OpenLIT Contributor Rules

## Repository Scope

- This repository is the open-source CE/OSS codebase.
- Do not add enterprise implementation files here.
- CE may contain shared contracts, neutral extension hook types, empty feature lists, disabled feature placeholders, upgrade-required responses, and OSS-safe no-op extension fallbacks.
- CE must not contain enterprise permission names, RBAC policy maps, entitlement feature maps, paid-plan branching, enterprise imports, or private implementation details.
- Enterprise-only implementation belongs in the private `openlit-enterprise` repository under `src/client/src/ee/`.
- RBAC, audit log, billing, licensing, seats, entitlements, enterprise stores/selectors, enterprise route handlers, and enterprise UI must stay out of CE and live under `openlit-enterprise/src/client/src/ee/**`.
- Common/shared behavior must be implemented here in CE first, then synced into `openlit-enterprise`; enterprise `app/**` route/page files should be thin wrappers only when they need Next.js filesystem routing.
- If shared code needs an enterprise extension point, add a stable shared import with a CE no-op fallback here, then let `openlit-enterprise` override it from `src/client/src/ee/**`.
- Shared imports must use neutral paths such as `@/lib/access/route-access`, `@/components/rbac/feature-access`, `@/components/enterprise-feature-access-provider`, or `@/store/enterprise`; never import `@/ee/**` from CE or shared/common files.
- CE fallback APIs should expose feature-agnostic keys such as `dashboard.read`, not permission literals such as `dashboard:read`. The enterprise repo maps neutral keys to actual permissions under `src/client/src/ee/**`.
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
rg -n "@/ee/" src
rg -n '"[a-z_]+:[a-z_]+"' src
```

Review the colon-string scan manually. CSS variants, cache keys, and encrypted-value prefixes are fine; RBAC permission literals are not.

## Security Rules

- UI feature checks are presentation only. Server routes must enforce authorization.
- Do not log raw secrets, tokens, passwords, cookies, license keys, or authorization headers.
- Audit metadata must be redacted before persistence.
- Internal APIs must use constant-time key comparisons.
- Stripe webhooks must verify signatures before processing payloads.
