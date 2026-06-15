# OpenLIT Agent Rules

## CE/OSS Boundary

- This repository is the open-source CE/OSS codebase.
- Do not add enterprise implementation here.
- CE may contain shared contracts, empty feature lists, disabled feature placeholders, upgrade-required responses, and OSS-safe no-op extension fallbacks.
- Enterprise implementation belongs in `openlit-enterprise/src/client/src/ee/`.
- RBAC, audit log, billing, licensing, seats, entitlements, enterprise stores/selectors, enterprise route handlers, and enterprise UI must stay out of CE and live under `openlit-enterprise/src/client/src/ee/**`.
- Common/shared behavior must be implemented here in CE first, then synced into `openlit-enterprise`; enterprise `app/**` route/page files should be thin wrappers only when they need Next.js filesystem routing.

## Extension Points

- Shared code may import a stable extension hook only when CE provides a no-op fallback.
- Do not import private enterprise modules from CE.
- Keep CE messages in `src/client/src/constants/messages/en.ts`; enterprise-only messages belong in `src/client/src/ee/constants/messages/en.ts` in the private repo.

## Project Hierarchy

- The hierarchy is `Organisation -> Project -> Database configuration`.
- Database config reads, writes, selection, and ping state must be scoped by current project.
- Billing, licensing, seats, and entitlements are organisation-scoped in enterprise.

## Validation

- Add tests for changed security boundaries.
- Run focused tests and `npm run lint` from `src/client` before handoff.
